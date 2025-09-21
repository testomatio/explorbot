import { __commonJS, __require, __toESM } from './maclay-y62a35vv.js';

// node_modules/ws/lib/constants.js
var require_constants = __commonJS((exports, module) => {
  var BINARY_TYPES = ['nodebuffer', 'arraybuffer', 'fragments'];
  var hasBlob = typeof Blob !== 'undefined';
  if (hasBlob) BINARY_TYPES.push('blob');
  module.exports = {
    BINARY_TYPES,
    EMPTY_BUFFER: Buffer.alloc(0),
    GUID: '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
    hasBlob,
    kForOnEventAttribute: Symbol('kIsForOnEventAttribute'),
    kListener: Symbol('kListener'),
    kStatusCode: Symbol('status-code'),
    kWebSocket: Symbol('websocket'),
    NOOP: () => {},
  };
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS((exports, module) => {
  var { EMPTY_BUFFER } = require_constants();
  var FastBuffer = Buffer[Symbol.species];
  function concat(list, totalLength) {
    if (list.length === 0) return EMPTY_BUFFER;
    if (list.length === 1) return list[0];
    const target = Buffer.allocUnsafe(totalLength);
    let offset = 0;
    for (let i = 0; i < list.length; i++) {
      const buf = list[i];
      target.set(buf, offset);
      offset += buf.length;
    }
    if (offset < totalLength) {
      return new FastBuffer(target.buffer, target.byteOffset, offset);
    }
    return target;
  }
  function _mask(source, mask, output, offset, length) {
    for (let i = 0; i < length; i++) {
      output[offset + i] = source[i] ^ mask[i & 3];
    }
  }
  function _unmask(buffer, mask) {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] ^= mask[i & 3];
    }
  }
  function toArrayBuffer(buf) {
    if (buf.length === buf.buffer.byteLength) {
      return buf.buffer;
    }
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  }
  function toBuffer(data) {
    toBuffer.readOnly = true;
    if (Buffer.isBuffer(data)) return data;
    let buf;
    if (data instanceof ArrayBuffer) {
      buf = new FastBuffer(data);
    } else if (ArrayBuffer.isView(data)) {
      buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
    } else {
      buf = Buffer.from(data);
      toBuffer.readOnly = false;
    }
    return buf;
  }
  module.exports = {
    concat,
    mask: _mask,
    toArrayBuffer,
    toBuffer,
    unmask: _unmask,
  };
  if (!process.env.WS_NO_BUFFER_UTIL) {
    try {
      const bufferUtil = (() => {
        throw new Error('Cannot require module ' + 'bufferutil');
      })();
      module.exports.mask = function (source, mask, output, offset, length) {
        if (length < 48) _mask(source, mask, output, offset, length);
        else bufferUtil.mask(source, mask, output, offset, length);
      };
      module.exports.unmask = function (buffer, mask) {
        if (buffer.length < 32) _unmask(buffer, mask);
        else bufferUtil.unmask(buffer, mask);
      };
    } catch (e) {}
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS((exports, module) => {
  var kDone = Symbol('kDone');
  var kRun = Symbol('kRun');

  class Limiter {
    constructor(concurrency) {
      this[kDone] = () => {
        this.pending--;
        this[kRun]();
      };
      this.concurrency = concurrency || Infinity;
      this.jobs = [];
      this.pending = 0;
    }
    add(job) {
      this.jobs.push(job);
      this[kRun]();
    }
    [kRun]() {
      if (this.pending === this.concurrency) return;
      if (this.jobs.length) {
        const job = this.jobs.shift();
        this.pending++;
        job(this[kDone]);
      }
    }
  }
  module.exports = Limiter;
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS((exports, module) => {
  var zlib = __require('zlib');
  var bufferUtil = require_buffer_util();
  var Limiter = require_limiter();
  var { kStatusCode } = require_constants();
  var FastBuffer = Buffer[Symbol.species];
  var TRAILER = Buffer.from([0, 0, 255, 255]);
  var kPerMessageDeflate = Symbol('permessage-deflate');
  var kTotalLength = Symbol('total-length');
  var kCallback = Symbol('callback');
  var kBuffers = Symbol('buffers');
  var kError = Symbol('error');
  var zlibLimiter;

  class PerMessageDeflate {
    constructor(options, isServer, maxPayload) {
      this._maxPayload = maxPayload | 0;
      this._options = options || {};
      this._threshold =
        this._options.threshold !== undefined ? this._options.threshold : 1024;
      this._isServer = !!isServer;
      this._deflate = null;
      this._inflate = null;
      this.params = null;
      if (!zlibLimiter) {
        const concurrency =
          this._options.concurrencyLimit !== undefined
            ? this._options.concurrencyLimit
            : 10;
        zlibLimiter = new Limiter(concurrency);
      }
    }
    static get extensionName() {
      return 'permessage-deflate';
    }
    offer() {
      const params = {};
      if (this._options.serverNoContextTakeover) {
        params.server_no_context_takeover = true;
      }
      if (this._options.clientNoContextTakeover) {
        params.client_no_context_takeover = true;
      }
      if (this._options.serverMaxWindowBits) {
        params.server_max_window_bits = this._options.serverMaxWindowBits;
      }
      if (this._options.clientMaxWindowBits) {
        params.client_max_window_bits = this._options.clientMaxWindowBits;
      } else if (this._options.clientMaxWindowBits == null) {
        params.client_max_window_bits = true;
      }
      return params;
    }
    accept(configurations) {
      configurations = this.normalizeParams(configurations);
      this.params = this._isServer
        ? this.acceptAsServer(configurations)
        : this.acceptAsClient(configurations);
      return this.params;
    }
    cleanup() {
      if (this._inflate) {
        this._inflate.close();
        this._inflate = null;
      }
      if (this._deflate) {
        const callback = this._deflate[kCallback];
        this._deflate.close();
        this._deflate = null;
        if (callback) {
          callback(
            new Error(
              'The deflate stream was closed while data was being processed'
            )
          );
        }
      }
    }
    acceptAsServer(offers) {
      const opts = this._options;
      const accepted = offers.find((params) => {
        if (
          (opts.serverNoContextTakeover === false &&
            params.server_no_context_takeover) ||
          (params.server_max_window_bits &&
            (opts.serverMaxWindowBits === false ||
              (typeof opts.serverMaxWindowBits === 'number' &&
                opts.serverMaxWindowBits > params.server_max_window_bits))) ||
          (typeof opts.clientMaxWindowBits === 'number' &&
            !params.client_max_window_bits)
        ) {
          return false;
        }
        return true;
      });
      if (!accepted) {
        throw new Error('None of the extension offers can be accepted');
      }
      if (opts.serverNoContextTakeover) {
        accepted.server_no_context_takeover = true;
      }
      if (opts.clientNoContextTakeover) {
        accepted.client_no_context_takeover = true;
      }
      if (typeof opts.serverMaxWindowBits === 'number') {
        accepted.server_max_window_bits = opts.serverMaxWindowBits;
      }
      if (typeof opts.clientMaxWindowBits === 'number') {
        accepted.client_max_window_bits = opts.clientMaxWindowBits;
      } else if (
        accepted.client_max_window_bits === true ||
        opts.clientMaxWindowBits === false
      ) {
        delete accepted.client_max_window_bits;
      }
      return accepted;
    }
    acceptAsClient(response) {
      const params = response[0];
      if (
        this._options.clientNoContextTakeover === false &&
        params.client_no_context_takeover
      ) {
        throw new Error('Unexpected parameter "client_no_context_takeover"');
      }
      if (!params.client_max_window_bits) {
        if (typeof this._options.clientMaxWindowBits === 'number') {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        }
      } else if (
        this._options.clientMaxWindowBits === false ||
        (typeof this._options.clientMaxWindowBits === 'number' &&
          params.client_max_window_bits > this._options.clientMaxWindowBits)
      ) {
        throw new Error(
          'Unexpected or invalid parameter "client_max_window_bits"'
        );
      }
      return params;
    }
    normalizeParams(configurations) {
      configurations.forEach((params) => {
        Object.keys(params).forEach((key) => {
          let value = params[key];
          if (value.length > 1) {
            throw new Error(`Parameter "${key}" must have only a single value`);
          }
          value = value[0];
          if (key === 'client_max_window_bits') {
            if (value !== true) {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (!this._isServer) {
              throw new TypeError(
                `Invalid value for parameter "${key}": ${value}`
              );
            }
          } else if (key === 'server_max_window_bits') {
            const num = +value;
            if (!Number.isInteger(num) || num < 8 || num > 15) {
              throw new TypeError(
                `Invalid value for parameter "${key}": ${value}`
              );
            }
            value = num;
          } else if (
            key === 'client_no_context_takeover' ||
            key === 'server_no_context_takeover'
          ) {
            if (value !== true) {
              throw new TypeError(
                `Invalid value for parameter "${key}": ${value}`
              );
            }
          } else {
            throw new Error(`Unknown parameter "${key}"`);
          }
          params[key] = value;
        });
      });
      return configurations;
    }
    decompress(data, fin, callback) {
      zlibLimiter.add((done) => {
        this._decompress(data, fin, (err, result) => {
          done();
          callback(err, result);
        });
      });
    }
    compress(data, fin, callback) {
      zlibLimiter.add((done) => {
        this._compress(data, fin, (err, result) => {
          done();
          callback(err, result);
        });
      });
    }
    _decompress(data, fin, callback) {
      const endpoint = this._isServer ? 'client' : 'server';
      if (!this._inflate) {
        const key = `${endpoint}_max_window_bits`;
        const windowBits =
          typeof this.params[key] !== 'number'
            ? zlib.Z_DEFAULT_WINDOWBITS
            : this.params[key];
        this._inflate = zlib.createInflateRaw({
          ...this._options.zlibInflateOptions,
          windowBits,
        });
        this._inflate[kPerMessageDeflate] = this;
        this._inflate[kTotalLength] = 0;
        this._inflate[kBuffers] = [];
        this._inflate.on('error', inflateOnError);
        this._inflate.on('data', inflateOnData);
      }
      this._inflate[kCallback] = callback;
      this._inflate.write(data);
      if (fin) this._inflate.write(TRAILER);
      this._inflate.flush(() => {
        const err = this._inflate[kError];
        if (err) {
          this._inflate.close();
          this._inflate = null;
          callback(err);
          return;
        }
        const data2 = bufferUtil.concat(
          this._inflate[kBuffers],
          this._inflate[kTotalLength]
        );
        if (this._inflate._readableState.endEmitted) {
          this._inflate.close();
          this._inflate = null;
        } else {
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._inflate.reset();
          }
        }
        callback(null, data2);
      });
    }
    _compress(data, fin, callback) {
      const endpoint = this._isServer ? 'server' : 'client';
      if (!this._deflate) {
        const key = `${endpoint}_max_window_bits`;
        const windowBits =
          typeof this.params[key] !== 'number'
            ? zlib.Z_DEFAULT_WINDOWBITS
            : this.params[key];
        this._deflate = zlib.createDeflateRaw({
          ...this._options.zlibDeflateOptions,
          windowBits,
        });
        this._deflate[kTotalLength] = 0;
        this._deflate[kBuffers] = [];
        this._deflate.on('data', deflateOnData);
      }
      this._deflate[kCallback] = callback;
      this._deflate.write(data);
      this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
        if (!this._deflate) {
          return;
        }
        let data2 = bufferUtil.concat(
          this._deflate[kBuffers],
          this._deflate[kTotalLength]
        );
        if (fin) {
          data2 = new FastBuffer(
            data2.buffer,
            data2.byteOffset,
            data2.length - 4
          );
        }
        this._deflate[kCallback] = null;
        this._deflate[kTotalLength] = 0;
        this._deflate[kBuffers] = [];
        if (fin && this.params[`${endpoint}_no_context_takeover`]) {
          this._deflate.reset();
        }
        callback(null, data2);
      });
    }
  }
  module.exports = PerMessageDeflate;
  function deflateOnData(chunk) {
    this[kBuffers].push(chunk);
    this[kTotalLength] += chunk.length;
  }
  function inflateOnData(chunk) {
    this[kTotalLength] += chunk.length;
    if (
      this[kPerMessageDeflate]._maxPayload < 1 ||
      this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload
    ) {
      this[kBuffers].push(chunk);
      return;
    }
    this[kError] = new RangeError('Max payload size exceeded');
    this[kError].code = 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH';
    this[kError][kStatusCode] = 1009;
    this.removeListener('data', inflateOnData);
    this.reset();
  }
  function inflateOnError(err) {
    this[kPerMessageDeflate]._inflate = null;
    if (this[kError]) {
      this[kCallback](this[kError]);
      return;
    }
    err[kStatusCode] = 1007;
    this[kCallback](err);
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS((exports, module) => {
  var { isUtf8 } = __require('buffer');
  var { hasBlob } = require_constants();
  var tokenChars = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1,
    0, 1, 0,
  ];
  function isValidStatusCode(code) {
    return (
      (code >= 1000 &&
        code <= 1014 &&
        code !== 1004 &&
        code !== 1005 &&
        code !== 1006) ||
      (code >= 3000 && code <= 4999)
    );
  }
  function _isValidUTF8(buf) {
    const len = buf.length;
    let i = 0;
    while (i < len) {
      if ((buf[i] & 128) === 0) {
        i++;
      } else if ((buf[i] & 224) === 192) {
        if (
          i + 1 === len ||
          (buf[i + 1] & 192) !== 128 ||
          (buf[i] & 254) === 192
        ) {
          return false;
        }
        i += 2;
      } else if ((buf[i] & 240) === 224) {
        if (
          i + 2 >= len ||
          (buf[i + 1] & 192) !== 128 ||
          (buf[i + 2] & 192) !== 128 ||
          (buf[i] === 224 && (buf[i + 1] & 224) === 128) ||
          (buf[i] === 237 && (buf[i + 1] & 224) === 160)
        ) {
          return false;
        }
        i += 3;
      } else if ((buf[i] & 248) === 240) {
        if (
          i + 3 >= len ||
          (buf[i + 1] & 192) !== 128 ||
          (buf[i + 2] & 192) !== 128 ||
          (buf[i + 3] & 192) !== 128 ||
          (buf[i] === 240 && (buf[i + 1] & 240) === 128) ||
          (buf[i] === 244 && buf[i + 1] > 143) ||
          buf[i] > 244
        ) {
          return false;
        }
        i += 4;
      } else {
        return false;
      }
    }
    return true;
  }
  function isBlob(value) {
    return (
      hasBlob &&
      typeof value === 'object' &&
      typeof value.arrayBuffer === 'function' &&
      typeof value.type === 'string' &&
      typeof value.stream === 'function' &&
      (value[Symbol.toStringTag] === 'Blob' ||
        value[Symbol.toStringTag] === 'File')
    );
  }
  module.exports = {
    isBlob,
    isValidStatusCode,
    isValidUTF8: _isValidUTF8,
    tokenChars,
  };
  if (isUtf8) {
    module.exports.isValidUTF8 = function (buf) {
      return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
    };
  } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
    try {
      const isValidUTF8 = (() => {
        throw new Error('Cannot require module ' + 'utf-8-validate');
      })();
      module.exports.isValidUTF8 = function (buf) {
        return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
      };
    } catch (e) {}
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS((exports, module) => {
  var { Writable } = __require('stream');
  var PerMessageDeflate = require_permessage_deflate();
  var { BINARY_TYPES, EMPTY_BUFFER, kStatusCode, kWebSocket } =
    require_constants();
  var { concat, toArrayBuffer, unmask } = require_buffer_util();
  var { isValidStatusCode, isValidUTF8 } = require_validation();
  var FastBuffer = Buffer[Symbol.species];
  var GET_INFO = 0;
  var GET_PAYLOAD_LENGTH_16 = 1;
  var GET_PAYLOAD_LENGTH_64 = 2;
  var GET_MASK = 3;
  var GET_DATA = 4;
  var INFLATING = 5;
  var DEFER_EVENT = 6;

  class Receiver extends Writable {
    constructor(options = {}) {
      super();
      this._allowSynchronousEvents =
        options.allowSynchronousEvents !== undefined
          ? options.allowSynchronousEvents
          : true;
      this._binaryType = options.binaryType || BINARY_TYPES[0];
      this._extensions = options.extensions || {};
      this._isServer = !!options.isServer;
      this._maxPayload = options.maxPayload | 0;
      this._skipUTF8Validation = !!options.skipUTF8Validation;
      this[kWebSocket] = undefined;
      this._bufferedBytes = 0;
      this._buffers = [];
      this._compressed = false;
      this._payloadLength = 0;
      this._mask = undefined;
      this._fragmented = 0;
      this._masked = false;
      this._fin = false;
      this._opcode = 0;
      this._totalPayloadLength = 0;
      this._messageLength = 0;
      this._fragments = [];
      this._errored = false;
      this._loop = false;
      this._state = GET_INFO;
    }
    _write(chunk, encoding, cb) {
      if (this._opcode === 8 && this._state == GET_INFO) return cb();
      this._bufferedBytes += chunk.length;
      this._buffers.push(chunk);
      this.startLoop(cb);
    }
    consume(n) {
      this._bufferedBytes -= n;
      if (n === this._buffers[0].length) return this._buffers.shift();
      if (n < this._buffers[0].length) {
        const buf = this._buffers[0];
        this._buffers[0] = new FastBuffer(
          buf.buffer,
          buf.byteOffset + n,
          buf.length - n
        );
        return new FastBuffer(buf.buffer, buf.byteOffset, n);
      }
      const dst = Buffer.allocUnsafe(n);
      do {
        const buf = this._buffers[0];
        const offset = dst.length - n;
        if (n >= buf.length) {
          dst.set(this._buffers.shift(), offset);
        } else {
          dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
        }
        n -= buf.length;
      } while (n > 0);
      return dst;
    }
    startLoop(cb) {
      this._loop = true;
      do {
        switch (this._state) {
          case GET_INFO:
            this.getInfo(cb);
            break;
          case GET_PAYLOAD_LENGTH_16:
            this.getPayloadLength16(cb);
            break;
          case GET_PAYLOAD_LENGTH_64:
            this.getPayloadLength64(cb);
            break;
          case GET_MASK:
            this.getMask();
            break;
          case GET_DATA:
            this.getData(cb);
            break;
          case INFLATING:
          case DEFER_EVENT:
            this._loop = false;
            return;
        }
      } while (this._loop);
      if (!this._errored) cb();
    }
    getInfo(cb) {
      if (this._bufferedBytes < 2) {
        this._loop = false;
        return;
      }
      const buf = this.consume(2);
      if ((buf[0] & 48) !== 0) {
        const error = this.createError(
          RangeError,
          'RSV2 and RSV3 must be clear',
          true,
          1002,
          'WS_ERR_UNEXPECTED_RSV_2_3'
        );
        cb(error);
        return;
      }
      const compressed = (buf[0] & 64) === 64;
      if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
        const error = this.createError(
          RangeError,
          'RSV1 must be clear',
          true,
          1002,
          'WS_ERR_UNEXPECTED_RSV_1'
        );
        cb(error);
        return;
      }
      this._fin = (buf[0] & 128) === 128;
      this._opcode = buf[0] & 15;
      this._payloadLength = buf[1] & 127;
      if (this._opcode === 0) {
        if (compressed) {
          const error = this.createError(
            RangeError,
            'RSV1 must be clear',
            true,
            1002,
            'WS_ERR_UNEXPECTED_RSV_1'
          );
          cb(error);
          return;
        }
        if (!this._fragmented) {
          const error = this.createError(
            RangeError,
            'invalid opcode 0',
            true,
            1002,
            'WS_ERR_INVALID_OPCODE'
          );
          cb(error);
          return;
        }
        this._opcode = this._fragmented;
      } else if (this._opcode === 1 || this._opcode === 2) {
        if (this._fragmented) {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            'WS_ERR_INVALID_OPCODE'
          );
          cb(error);
          return;
        }
        this._compressed = compressed;
      } else if (this._opcode > 7 && this._opcode < 11) {
        if (!this._fin) {
          const error = this.createError(
            RangeError,
            'FIN must be set',
            true,
            1002,
            'WS_ERR_EXPECTED_FIN'
          );
          cb(error);
          return;
        }
        if (compressed) {
          const error = this.createError(
            RangeError,
            'RSV1 must be clear',
            true,
            1002,
            'WS_ERR_UNEXPECTED_RSV_1'
          );
          cb(error);
          return;
        }
        if (
          this._payloadLength > 125 ||
          (this._opcode === 8 && this._payloadLength === 1)
        ) {
          const error = this.createError(
            RangeError,
            `invalid payload length ${this._payloadLength}`,
            true,
            1002,
            'WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH'
          );
          cb(error);
          return;
        }
      } else {
        const error = this.createError(
          RangeError,
          `invalid opcode ${this._opcode}`,
          true,
          1002,
          'WS_ERR_INVALID_OPCODE'
        );
        cb(error);
        return;
      }
      if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
      this._masked = (buf[1] & 128) === 128;
      if (this._isServer) {
        if (!this._masked) {
          const error = this.createError(
            RangeError,
            'MASK must be set',
            true,
            1002,
            'WS_ERR_EXPECTED_MASK'
          );
          cb(error);
          return;
        }
      } else if (this._masked) {
        const error = this.createError(
          RangeError,
          'MASK must be clear',
          true,
          1002,
          'WS_ERR_UNEXPECTED_MASK'
        );
        cb(error);
        return;
      }
      if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
      else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
      else this.haveLength(cb);
    }
    getPayloadLength16(cb) {
      if (this._bufferedBytes < 2) {
        this._loop = false;
        return;
      }
      this._payloadLength = this.consume(2).readUInt16BE(0);
      this.haveLength(cb);
    }
    getPayloadLength64(cb) {
      if (this._bufferedBytes < 8) {
        this._loop = false;
        return;
      }
      const buf = this.consume(8);
      const num = buf.readUInt32BE(0);
      if (num > Math.pow(2, 53 - 32) - 1) {
        const error = this.createError(
          RangeError,
          'Unsupported WebSocket frame: payload length > 2^53 - 1',
          false,
          1009,
          'WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH'
        );
        cb(error);
        return;
      }
      this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
      this.haveLength(cb);
    }
    haveLength(cb) {
      if (this._payloadLength && this._opcode < 8) {
        this._totalPayloadLength += this._payloadLength;
        if (
          this._totalPayloadLength > this._maxPayload &&
          this._maxPayload > 0
        ) {
          const error = this.createError(
            RangeError,
            'Max payload size exceeded',
            false,
            1009,
            'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
          );
          cb(error);
          return;
        }
      }
      if (this._masked) this._state = GET_MASK;
      else this._state = GET_DATA;
    }
    getMask() {
      if (this._bufferedBytes < 4) {
        this._loop = false;
        return;
      }
      this._mask = this.consume(4);
      this._state = GET_DATA;
    }
    getData(cb) {
      let data = EMPTY_BUFFER;
      if (this._payloadLength) {
        if (this._bufferedBytes < this._payloadLength) {
          this._loop = false;
          return;
        }
        data = this.consume(this._payloadLength);
        if (
          this._masked &&
          (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0
        ) {
          unmask(data, this._mask);
        }
      }
      if (this._opcode > 7) {
        this.controlMessage(data, cb);
        return;
      }
      if (this._compressed) {
        this._state = INFLATING;
        this.decompress(data, cb);
        return;
      }
      if (data.length) {
        this._messageLength = this._totalPayloadLength;
        this._fragments.push(data);
      }
      this.dataMessage(cb);
    }
    decompress(data, cb) {
      const perMessageDeflate =
        this._extensions[PerMessageDeflate.extensionName];
      perMessageDeflate.decompress(data, this._fin, (err, buf) => {
        if (err) return cb(err);
        if (buf.length) {
          this._messageLength += buf.length;
          if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              'Max payload size exceeded',
              false,
              1009,
              'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
            );
            cb(error);
            return;
          }
          this._fragments.push(buf);
        }
        this.dataMessage(cb);
        if (this._state === GET_INFO) this.startLoop(cb);
      });
    }
    dataMessage(cb) {
      if (!this._fin) {
        this._state = GET_INFO;
        return;
      }
      const messageLength = this._messageLength;
      const fragments = this._fragments;
      this._totalPayloadLength = 0;
      this._messageLength = 0;
      this._fragmented = 0;
      this._fragments = [];
      if (this._opcode === 2) {
        let data;
        if (this._binaryType === 'nodebuffer') {
          data = concat(fragments, messageLength);
        } else if (this._binaryType === 'arraybuffer') {
          data = toArrayBuffer(concat(fragments, messageLength));
        } else if (this._binaryType === 'blob') {
          data = new Blob(fragments);
        } else {
          data = fragments;
        }
        if (this._allowSynchronousEvents) {
          this.emit('message', data, true);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit('message', data, true);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      } else {
        const buf = concat(fragments, messageLength);
        if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
          const error = this.createError(
            Error,
            'invalid UTF-8 sequence',
            true,
            1007,
            'WS_ERR_INVALID_UTF8'
          );
          cb(error);
          return;
        }
        if (this._state === INFLATING || this._allowSynchronousEvents) {
          this.emit('message', buf, false);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit('message', buf, false);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
    }
    controlMessage(data, cb) {
      if (this._opcode === 8) {
        if (data.length === 0) {
          this._loop = false;
          this.emit('conclude', 1005, EMPTY_BUFFER);
          this.end();
        } else {
          const code = data.readUInt16BE(0);
          if (!isValidStatusCode(code)) {
            const error = this.createError(
              RangeError,
              `invalid status code ${code}`,
              true,
              1002,
              'WS_ERR_INVALID_CLOSE_CODE'
            );
            cb(error);
            return;
          }
          const buf = new FastBuffer(
            data.buffer,
            data.byteOffset + 2,
            data.length - 2
          );
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              'invalid UTF-8 sequence',
              true,
              1007,
              'WS_ERR_INVALID_UTF8'
            );
            cb(error);
            return;
          }
          this._loop = false;
          this.emit('conclude', code, buf);
          this.end();
        }
        this._state = GET_INFO;
        return;
      }
      if (this._allowSynchronousEvents) {
        this.emit(this._opcode === 9 ? 'ping' : 'pong', data);
        this._state = GET_INFO;
      } else {
        this._state = DEFER_EVENT;
        setImmediate(() => {
          this.emit(this._opcode === 9 ? 'ping' : 'pong', data);
          this._state = GET_INFO;
          this.startLoop(cb);
        });
      }
    }
    createError(ErrorCtor, message, prefix, statusCode, errorCode) {
      this._loop = false;
      this._errored = true;
      const err = new ErrorCtor(
        prefix ? `Invalid WebSocket frame: ${message}` : message
      );
      Error.captureStackTrace(err, this.createError);
      err.code = errorCode;
      err[kStatusCode] = statusCode;
      return err;
    }
  }
  module.exports = Receiver;
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS((exports, module) => {
  var { Duplex } = __require('stream');
  var { randomFillSync } = __require('crypto');
  var PerMessageDeflate = require_permessage_deflate();
  var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
  var { isBlob, isValidStatusCode } = require_validation();
  var { mask: applyMask, toBuffer } = require_buffer_util();
  var kByteLength = Symbol('kByteLength');
  var maskBuffer = Buffer.alloc(4);
  var RANDOM_POOL_SIZE = 8 * 1024;
  var randomPool;
  var randomPoolPointer = RANDOM_POOL_SIZE;
  var DEFAULT = 0;
  var DEFLATING = 1;
  var GET_BLOB_DATA = 2;

  class Sender {
    constructor(socket, extensions, generateMask) {
      this._extensions = extensions || {};
      if (generateMask) {
        this._generateMask = generateMask;
        this._maskBuffer = Buffer.alloc(4);
      }
      this._socket = socket;
      this._firstFragment = true;
      this._compress = false;
      this._bufferedBytes = 0;
      this._queue = [];
      this._state = DEFAULT;
      this.onerror = NOOP;
      this[kWebSocket] = undefined;
    }
    static frame(data, options) {
      let mask;
      let merge = false;
      let offset = 2;
      let skipMasking = false;
      if (options.mask) {
        mask = options.maskBuffer || maskBuffer;
        if (options.generateMask) {
          options.generateMask(mask);
        } else {
          if (randomPoolPointer === RANDOM_POOL_SIZE) {
            if (randomPool === undefined) {
              randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
            }
            randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
            randomPoolPointer = 0;
          }
          mask[0] = randomPool[randomPoolPointer++];
          mask[1] = randomPool[randomPoolPointer++];
          mask[2] = randomPool[randomPoolPointer++];
          mask[3] = randomPool[randomPoolPointer++];
        }
        skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
        offset = 6;
      }
      let dataLength;
      if (typeof data === 'string') {
        if (
          (!options.mask || skipMasking) &&
          options[kByteLength] !== undefined
        ) {
          dataLength = options[kByteLength];
        } else {
          data = Buffer.from(data);
          dataLength = data.length;
        }
      } else {
        dataLength = data.length;
        merge = options.mask && options.readOnly && !skipMasking;
      }
      let payloadLength = dataLength;
      if (dataLength >= 65536) {
        offset += 8;
        payloadLength = 127;
      } else if (dataLength > 125) {
        offset += 2;
        payloadLength = 126;
      }
      const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
      target[0] = options.fin ? options.opcode | 128 : options.opcode;
      if (options.rsv1) target[0] |= 64;
      target[1] = payloadLength;
      if (payloadLength === 126) {
        target.writeUInt16BE(dataLength, 2);
      } else if (payloadLength === 127) {
        target[2] = target[3] = 0;
        target.writeUIntBE(dataLength, 4, 6);
      }
      if (!options.mask) return [target, data];
      target[1] |= 128;
      target[offset - 4] = mask[0];
      target[offset - 3] = mask[1];
      target[offset - 2] = mask[2];
      target[offset - 1] = mask[3];
      if (skipMasking) return [target, data];
      if (merge) {
        applyMask(data, mask, target, offset, dataLength);
        return [target];
      }
      applyMask(data, mask, data, 0, dataLength);
      return [target, data];
    }
    close(code, data, mask, cb) {
      let buf;
      if (code === undefined) {
        buf = EMPTY_BUFFER;
      } else if (typeof code !== 'number' || !isValidStatusCode(code)) {
        throw new TypeError('First argument must be a valid error code number');
      } else if (data === undefined || !data.length) {
        buf = Buffer.allocUnsafe(2);
        buf.writeUInt16BE(code, 0);
      } else {
        const length = Buffer.byteLength(data);
        if (length > 123) {
          throw new RangeError(
            'The message must not be greater than 123 bytes'
          );
        }
        buf = Buffer.allocUnsafe(2 + length);
        buf.writeUInt16BE(code, 0);
        if (typeof data === 'string') {
          buf.write(data, 2);
        } else {
          buf.set(data, 2);
        }
      }
      const options = {
        [kByteLength]: buf.length,
        fin: true,
        generateMask: this._generateMask,
        mask,
        maskBuffer: this._maskBuffer,
        opcode: 8,
        readOnly: false,
        rsv1: false,
      };
      if (this._state !== DEFAULT) {
        this.enqueue([this.dispatch, buf, false, options, cb]);
      } else {
        this.sendFrame(Sender.frame(buf, options), cb);
      }
    }
    ping(data, mask, cb) {
      let byteLength;
      let readOnly;
      if (typeof data === 'string') {
        byteLength = Buffer.byteLength(data);
        readOnly = false;
      } else if (isBlob(data)) {
        byteLength = data.size;
        readOnly = false;
      } else {
        data = toBuffer(data);
        byteLength = data.length;
        readOnly = toBuffer.readOnly;
      }
      if (byteLength > 125) {
        throw new RangeError(
          'The data size must not be greater than 125 bytes'
        );
      }
      const options = {
        [kByteLength]: byteLength,
        fin: true,
        generateMask: this._generateMask,
        mask,
        maskBuffer: this._maskBuffer,
        opcode: 9,
        readOnly,
        rsv1: false,
      };
      if (isBlob(data)) {
        if (this._state !== DEFAULT) {
          this.enqueue([this.getBlobData, data, false, options, cb]);
        } else {
          this.getBlobData(data, false, options, cb);
        }
      } else if (this._state !== DEFAULT) {
        this.enqueue([this.dispatch, data, false, options, cb]);
      } else {
        this.sendFrame(Sender.frame(data, options), cb);
      }
    }
    pong(data, mask, cb) {
      let byteLength;
      let readOnly;
      if (typeof data === 'string') {
        byteLength = Buffer.byteLength(data);
        readOnly = false;
      } else if (isBlob(data)) {
        byteLength = data.size;
        readOnly = false;
      } else {
        data = toBuffer(data);
        byteLength = data.length;
        readOnly = toBuffer.readOnly;
      }
      if (byteLength > 125) {
        throw new RangeError(
          'The data size must not be greater than 125 bytes'
        );
      }
      const options = {
        [kByteLength]: byteLength,
        fin: true,
        generateMask: this._generateMask,
        mask,
        maskBuffer: this._maskBuffer,
        opcode: 10,
        readOnly,
        rsv1: false,
      };
      if (isBlob(data)) {
        if (this._state !== DEFAULT) {
          this.enqueue([this.getBlobData, data, false, options, cb]);
        } else {
          this.getBlobData(data, false, options, cb);
        }
      } else if (this._state !== DEFAULT) {
        this.enqueue([this.dispatch, data, false, options, cb]);
      } else {
        this.sendFrame(Sender.frame(data, options), cb);
      }
    }
    send(data, options, cb) {
      const perMessageDeflate =
        this._extensions[PerMessageDeflate.extensionName];
      let opcode = options.binary ? 2 : 1;
      let rsv1 = options.compress;
      let byteLength;
      let readOnly;
      if (typeof data === 'string') {
        byteLength = Buffer.byteLength(data);
        readOnly = false;
      } else if (isBlob(data)) {
        byteLength = data.size;
        readOnly = false;
      } else {
        data = toBuffer(data);
        byteLength = data.length;
        readOnly = toBuffer.readOnly;
      }
      if (this._firstFragment) {
        this._firstFragment = false;
        if (
          rsv1 &&
          perMessageDeflate &&
          perMessageDeflate.params[
            perMessageDeflate._isServer
              ? 'server_no_context_takeover'
              : 'client_no_context_takeover'
          ]
        ) {
          rsv1 = byteLength >= perMessageDeflate._threshold;
        }
        this._compress = rsv1;
      } else {
        rsv1 = false;
        opcode = 0;
      }
      if (options.fin) this._firstFragment = true;
      const opts = {
        [kByteLength]: byteLength,
        fin: options.fin,
        generateMask: this._generateMask,
        mask: options.mask,
        maskBuffer: this._maskBuffer,
        opcode,
        readOnly,
        rsv1,
      };
      if (isBlob(data)) {
        if (this._state !== DEFAULT) {
          this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
        } else {
          this.getBlobData(data, this._compress, opts, cb);
        }
      } else if (this._state !== DEFAULT) {
        this.enqueue([this.dispatch, data, this._compress, opts, cb]);
      } else {
        this.dispatch(data, this._compress, opts, cb);
      }
    }
    getBlobData(blob, compress, options, cb) {
      this._bufferedBytes += options[kByteLength];
      this._state = GET_BLOB_DATA;
      blob
        .arrayBuffer()
        .then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              'The socket was closed while the blob was being read'
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        })
        .catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
    }
    dispatch(data, compress, options, cb) {
      if (!compress) {
        this.sendFrame(Sender.frame(data, options), cb);
        return;
      }
      const perMessageDeflate =
        this._extensions[PerMessageDeflate.extensionName];
      this._bufferedBytes += options[kByteLength];
      this._state = DEFLATING;
      perMessageDeflate.compress(data, options.fin, (_, buf) => {
        if (this._socket.destroyed) {
          const err = new Error(
            'The socket was closed while data was being compressed'
          );
          callCallbacks(this, err, cb);
          return;
        }
        this._bufferedBytes -= options[kByteLength];
        this._state = DEFAULT;
        options.readOnly = false;
        this.sendFrame(Sender.frame(buf, options), cb);
        this.dequeue();
      });
    }
    dequeue() {
      while (this._state === DEFAULT && this._queue.length) {
        const params = this._queue.shift();
        this._bufferedBytes -= params[3][kByteLength];
        Reflect.apply(params[0], this, params.slice(1));
      }
    }
    enqueue(params) {
      this._bufferedBytes += params[3][kByteLength];
      this._queue.push(params);
    }
    sendFrame(list, cb) {
      if (list.length === 2) {
        this._socket.cork();
        this._socket.write(list[0]);
        this._socket.write(list[1], cb);
        this._socket.uncork();
      } else {
        this._socket.write(list[0], cb);
      }
    }
  }
  module.exports = Sender;
  function callCallbacks(sender, err, cb) {
    if (typeof cb === 'function') cb(err);
    for (let i = 0; i < sender._queue.length; i++) {
      const params = sender._queue[i];
      const callback = params[params.length - 1];
      if (typeof callback === 'function') callback(err);
    }
  }
  function onError(sender, err, cb) {
    callCallbacks(sender, err, cb);
    sender.onerror(err);
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS((exports, module) => {
  var { kForOnEventAttribute, kListener } = require_constants();
  var kCode = Symbol('kCode');
  var kData = Symbol('kData');
  var kError = Symbol('kError');
  var kMessage = Symbol('kMessage');
  var kReason = Symbol('kReason');
  var kTarget = Symbol('kTarget');
  var kType = Symbol('kType');
  var kWasClean = Symbol('kWasClean');

  class Event {
    constructor(type) {
      this[kTarget] = null;
      this[kType] = type;
    }
    get target() {
      return this[kTarget];
    }
    get type() {
      return this[kType];
    }
  }
  Object.defineProperty(Event.prototype, 'target', { enumerable: true });
  Object.defineProperty(Event.prototype, 'type', { enumerable: true });

  class CloseEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this[kCode] = options.code === undefined ? 0 : options.code;
      this[kReason] = options.reason === undefined ? '' : options.reason;
      this[kWasClean] =
        options.wasClean === undefined ? false : options.wasClean;
    }
    get code() {
      return this[kCode];
    }
    get reason() {
      return this[kReason];
    }
    get wasClean() {
      return this[kWasClean];
    }
  }
  Object.defineProperty(CloseEvent.prototype, 'code', { enumerable: true });
  Object.defineProperty(CloseEvent.prototype, 'reason', { enumerable: true });
  Object.defineProperty(CloseEvent.prototype, 'wasClean', { enumerable: true });

  class ErrorEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this[kError] = options.error === undefined ? null : options.error;
      this[kMessage] = options.message === undefined ? '' : options.message;
    }
    get error() {
      return this[kError];
    }
    get message() {
      return this[kMessage];
    }
  }
  Object.defineProperty(ErrorEvent.prototype, 'error', { enumerable: true });
  Object.defineProperty(ErrorEvent.prototype, 'message', { enumerable: true });

  class MessageEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this[kData] = options.data === undefined ? null : options.data;
    }
    get data() {
      return this[kData];
    }
  }
  Object.defineProperty(MessageEvent.prototype, 'data', { enumerable: true });
  var EventTarget = {
    addEventListener(type, handler, options = {}) {
      for (const listener of this.listeners(type)) {
        if (
          !options[kForOnEventAttribute] &&
          listener[kListener] === handler &&
          !listener[kForOnEventAttribute]
        ) {
          return;
        }
      }
      let wrapper;
      if (type === 'message') {
        wrapper = function onMessage(data, isBinary) {
          const event = new MessageEvent('message', {
            data: isBinary ? data : data.toString(),
          });
          event[kTarget] = this;
          callListener(handler, this, event);
        };
      } else if (type === 'close') {
        wrapper = function onClose(code, message) {
          const event = new CloseEvent('close', {
            code,
            reason: message.toString(),
            wasClean: this._closeFrameReceived && this._closeFrameSent,
          });
          event[kTarget] = this;
          callListener(handler, this, event);
        };
      } else if (type === 'error') {
        wrapper = function onError(error) {
          const event = new ErrorEvent('error', {
            error,
            message: error.message,
          });
          event[kTarget] = this;
          callListener(handler, this, event);
        };
      } else if (type === 'open') {
        wrapper = function onOpen() {
          const event = new Event('open');
          event[kTarget] = this;
          callListener(handler, this, event);
        };
      } else {
        return;
      }
      wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
      wrapper[kListener] = handler;
      if (options.once) {
        this.once(type, wrapper);
      } else {
        this.on(type, wrapper);
      }
    },
    removeEventListener(type, handler) {
      for (const listener of this.listeners(type)) {
        if (
          listener[kListener] === handler &&
          !listener[kForOnEventAttribute]
        ) {
          this.removeListener(type, listener);
          break;
        }
      }
    },
  };
  module.exports = {
    CloseEvent,
    ErrorEvent,
    Event,
    EventTarget,
    MessageEvent,
  };
  function callListener(listener, thisArg, event) {
    if (typeof listener === 'object' && listener.handleEvent) {
      listener.handleEvent.call(listener, event);
    } else {
      listener.call(thisArg, event);
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS((exports, module) => {
  var { tokenChars } = require_validation();
  function push(dest, name, elem) {
    if (dest[name] === undefined) dest[name] = [elem];
    else dest[name].push(elem);
  }
  function parse(header) {
    const offers = Object.create(null);
    let params = Object.create(null);
    let mustUnescape = false;
    let isEscaping = false;
    let inQuotes = false;
    let extensionName;
    let paramName;
    let start = -1;
    let code = -1;
    let end = -1;
    let i = 0;
    for (; i < header.length; i++) {
      code = header.charCodeAt(i);
      if (extensionName === undefined) {
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 59 || code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const name = header.slice(start, end);
          if (code === 44) {
            push(offers, name, params);
            params = Object.create(null);
          } else {
            extensionName = name;
          }
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      } else if (paramName === undefined) {
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (code === 32 || code === 9) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 59 || code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          push(params, header.slice(start, end), true);
          if (code === 44) {
            push(offers, extensionName, params);
            params = Object.create(null);
            extensionName = undefined;
          }
          start = end = -1;
        } else if (code === 61 && start !== -1 && end === -1) {
          paramName = header.slice(start, i);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      } else {
        if (isEscaping) {
          if (tokenChars[code] !== 1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (start === -1) start = i;
          else if (!mustUnescape) mustUnescape = true;
          isEscaping = false;
        } else if (inQuotes) {
          if (tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 34 && start !== -1) {
            inQuotes = false;
            end = i;
          } else if (code === 92) {
            isEscaping = true;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
          inQuotes = true;
        } else if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (start !== -1 && (code === 32 || code === 9)) {
          if (end === -1) end = i;
        } else if (code === 59 || code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          let value = header.slice(start, end);
          if (mustUnescape) {
            value = value.replace(/\\/g, '');
            mustUnescape = false;
          }
          push(params, paramName, value);
          if (code === 44) {
            push(offers, extensionName, params);
            params = Object.create(null);
            extensionName = undefined;
          }
          paramName = undefined;
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
    }
    if (start === -1 || inQuotes || code === 32 || code === 9) {
      throw new SyntaxError('Unexpected end of input');
    }
    if (end === -1) end = i;
    const token = header.slice(start, end);
    if (extensionName === undefined) {
      push(offers, token, params);
    } else {
      if (paramName === undefined) {
        push(params, token, true);
      } else if (mustUnescape) {
        push(params, paramName, token.replace(/\\/g, ''));
      } else {
        push(params, paramName, token);
      }
      push(offers, extensionName, params);
    }
    return offers;
  }
  function format(extensions) {
    return Object.keys(extensions)
      .map((extension) => {
        let configurations = extensions[extension];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations
          .map((params) => {
            return [extension]
              .concat(
                Object.keys(params).map((k) => {
                  let values = params[k];
                  if (!Array.isArray(values)) values = [values];
                  return values
                    .map((v) => (v === true ? k : `${k}=${v}`))
                    .join('; ');
                })
              )
              .join('; ');
          })
          .join(', ');
      })
      .join(', ');
  }
  module.exports = { format, parse };
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS((exports, module) => {
  var EventEmitter = __require('events');
  var https = __require('https');
  var http = __require('http');
  var net = __require('net');
  var tls = __require('tls');
  var { randomBytes, createHash } = __require('crypto');
  var { Duplex, Readable } = __require('stream');
  var { URL: URL2 } = __require('url');
  var PerMessageDeflate = require_permessage_deflate();
  var Receiver = require_receiver();
  var Sender = require_sender();
  var { isBlob } = require_validation();
  var {
    BINARY_TYPES,
    EMPTY_BUFFER,
    GUID,
    kForOnEventAttribute,
    kListener,
    kStatusCode,
    kWebSocket,
    NOOP,
  } = require_constants();
  var {
    EventTarget: { addEventListener, removeEventListener },
  } = require_event_target();
  var { format, parse } = require_extension();
  var { toBuffer } = require_buffer_util();
  var closeTimeout = 30 * 1000;
  var kAborted = Symbol('kAborted');
  var protocolVersions = [8, 13];
  var readyStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
  var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;

  class WebSocket extends EventEmitter {
    constructor(address, protocols, options) {
      super();
      this._binaryType = BINARY_TYPES[0];
      this._closeCode = 1006;
      this._closeFrameReceived = false;
      this._closeFrameSent = false;
      this._closeMessage = EMPTY_BUFFER;
      this._closeTimer = null;
      this._errorEmitted = false;
      this._extensions = {};
      this._paused = false;
      this._protocol = '';
      this._readyState = WebSocket.CONNECTING;
      this._receiver = null;
      this._sender = null;
      this._socket = null;
      if (address !== null) {
        this._bufferedAmount = 0;
        this._isServer = false;
        this._redirects = 0;
        if (protocols === undefined) {
          protocols = [];
        } else if (!Array.isArray(protocols)) {
          if (typeof protocols === 'object' && protocols !== null) {
            options = protocols;
            protocols = [];
          } else {
            protocols = [protocols];
          }
        }
        initAsClient(this, address, protocols, options);
      } else {
        this._autoPong = options.autoPong;
        this._isServer = true;
      }
    }
    get binaryType() {
      return this._binaryType;
    }
    set binaryType(type) {
      if (!BINARY_TYPES.includes(type)) return;
      this._binaryType = type;
      if (this._receiver) this._receiver._binaryType = type;
    }
    get bufferedAmount() {
      if (!this._socket) return this._bufferedAmount;
      return this._socket._writableState.length + this._sender._bufferedBytes;
    }
    get extensions() {
      return Object.keys(this._extensions).join();
    }
    get isPaused() {
      return this._paused;
    }
    get onclose() {
      return null;
    }
    get onerror() {
      return null;
    }
    get onopen() {
      return null;
    }
    get onmessage() {
      return null;
    }
    get protocol() {
      return this._protocol;
    }
    get readyState() {
      return this._readyState;
    }
    get url() {
      return this._url;
    }
    setSocket(socket, head, options) {
      const receiver = new Receiver({
        allowSynchronousEvents: options.allowSynchronousEvents,
        binaryType: this.binaryType,
        extensions: this._extensions,
        isServer: this._isServer,
        maxPayload: options.maxPayload,
        skipUTF8Validation: options.skipUTF8Validation,
      });
      const sender = new Sender(socket, this._extensions, options.generateMask);
      this._receiver = receiver;
      this._sender = sender;
      this._socket = socket;
      receiver[kWebSocket] = this;
      sender[kWebSocket] = this;
      socket[kWebSocket] = this;
      receiver.on('conclude', receiverOnConclude);
      receiver.on('drain', receiverOnDrain);
      receiver.on('error', receiverOnError);
      receiver.on('message', receiverOnMessage);
      receiver.on('ping', receiverOnPing);
      receiver.on('pong', receiverOnPong);
      sender.onerror = senderOnError;
      if (socket.setTimeout) socket.setTimeout(0);
      if (socket.setNoDelay) socket.setNoDelay();
      if (head.length > 0) socket.unshift(head);
      socket.on('close', socketOnClose);
      socket.on('data', socketOnData);
      socket.on('end', socketOnEnd);
      socket.on('error', socketOnError);
      this._readyState = WebSocket.OPEN;
      this.emit('open');
    }
    emitClose() {
      if (!this._socket) {
        this._readyState = WebSocket.CLOSED;
        this.emit('close', this._closeCode, this._closeMessage);
        return;
      }
      if (this._extensions[PerMessageDeflate.extensionName]) {
        this._extensions[PerMessageDeflate.extensionName].cleanup();
      }
      this._receiver.removeAllListeners();
      this._readyState = WebSocket.CLOSED;
      this.emit('close', this._closeCode, this._closeMessage);
    }
    close(code, data) {
      if (this.readyState === WebSocket.CLOSED) return;
      if (this.readyState === WebSocket.CONNECTING) {
        const msg =
          'WebSocket was closed before the connection was established';
        abortHandshake(this, this._req, msg);
        return;
      }
      if (this.readyState === WebSocket.CLOSING) {
        if (
          this._closeFrameSent &&
          (this._closeFrameReceived ||
            this._receiver._writableState.errorEmitted)
        ) {
          this._socket.end();
        }
        return;
      }
      this._readyState = WebSocket.CLOSING;
      this._sender.close(code, data, !this._isServer, (err) => {
        if (err) return;
        this._closeFrameSent = true;
        if (
          this._closeFrameReceived ||
          this._receiver._writableState.errorEmitted
        ) {
          this._socket.end();
        }
      });
      setCloseTimer(this);
    }
    pause() {
      if (
        this.readyState === WebSocket.CONNECTING ||
        this.readyState === WebSocket.CLOSED
      ) {
        return;
      }
      this._paused = true;
      this._socket.pause();
    }
    ping(data, mask, cb) {
      if (this.readyState === WebSocket.CONNECTING) {
        throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
      }
      if (typeof data === 'function') {
        cb = data;
        data = mask = undefined;
      } else if (typeof mask === 'function') {
        cb = mask;
        mask = undefined;
      }
      if (typeof data === 'number') data = data.toString();
      if (this.readyState !== WebSocket.OPEN) {
        sendAfterClose(this, data, cb);
        return;
      }
      if (mask === undefined) mask = !this._isServer;
      this._sender.ping(data || EMPTY_BUFFER, mask, cb);
    }
    pong(data, mask, cb) {
      if (this.readyState === WebSocket.CONNECTING) {
        throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
      }
      if (typeof data === 'function') {
        cb = data;
        data = mask = undefined;
      } else if (typeof mask === 'function') {
        cb = mask;
        mask = undefined;
      }
      if (typeof data === 'number') data = data.toString();
      if (this.readyState !== WebSocket.OPEN) {
        sendAfterClose(this, data, cb);
        return;
      }
      if (mask === undefined) mask = !this._isServer;
      this._sender.pong(data || EMPTY_BUFFER, mask, cb);
    }
    resume() {
      if (
        this.readyState === WebSocket.CONNECTING ||
        this.readyState === WebSocket.CLOSED
      ) {
        return;
      }
      this._paused = false;
      if (!this._receiver._writableState.needDrain) this._socket.resume();
    }
    send(data, options, cb) {
      if (this.readyState === WebSocket.CONNECTING) {
        throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
      }
      if (typeof options === 'function') {
        cb = options;
        options = {};
      }
      if (typeof data === 'number') data = data.toString();
      if (this.readyState !== WebSocket.OPEN) {
        sendAfterClose(this, data, cb);
        return;
      }
      const opts = {
        binary: typeof data !== 'string',
        mask: !this._isServer,
        compress: true,
        fin: true,
        ...options,
      };
      if (!this._extensions[PerMessageDeflate.extensionName]) {
        opts.compress = false;
      }
      this._sender.send(data || EMPTY_BUFFER, opts, cb);
    }
    terminate() {
      if (this.readyState === WebSocket.CLOSED) return;
      if (this.readyState === WebSocket.CONNECTING) {
        const msg =
          'WebSocket was closed before the connection was established';
        abortHandshake(this, this._req, msg);
        return;
      }
      if (this._socket) {
        this._readyState = WebSocket.CLOSING;
        this._socket.destroy();
      }
    }
  }
  Object.defineProperty(WebSocket, 'CONNECTING', {
    enumerable: true,
    value: readyStates.indexOf('CONNECTING'),
  });
  Object.defineProperty(WebSocket.prototype, 'CONNECTING', {
    enumerable: true,
    value: readyStates.indexOf('CONNECTING'),
  });
  Object.defineProperty(WebSocket, 'OPEN', {
    enumerable: true,
    value: readyStates.indexOf('OPEN'),
  });
  Object.defineProperty(WebSocket.prototype, 'OPEN', {
    enumerable: true,
    value: readyStates.indexOf('OPEN'),
  });
  Object.defineProperty(WebSocket, 'CLOSING', {
    enumerable: true,
    value: readyStates.indexOf('CLOSING'),
  });
  Object.defineProperty(WebSocket.prototype, 'CLOSING', {
    enumerable: true,
    value: readyStates.indexOf('CLOSING'),
  });
  Object.defineProperty(WebSocket, 'CLOSED', {
    enumerable: true,
    value: readyStates.indexOf('CLOSED'),
  });
  Object.defineProperty(WebSocket.prototype, 'CLOSED', {
    enumerable: true,
    value: readyStates.indexOf('CLOSED'),
  });
  [
    'binaryType',
    'bufferedAmount',
    'extensions',
    'isPaused',
    'protocol',
    'readyState',
    'url',
  ].forEach((property) => {
    Object.defineProperty(WebSocket.prototype, property, { enumerable: true });
  });
  ['open', 'error', 'close', 'message'].forEach((method) => {
    Object.defineProperty(WebSocket.prototype, `on${method}`, {
      enumerable: true,
      get() {
        for (const listener of this.listeners(method)) {
          if (listener[kForOnEventAttribute]) return listener[kListener];
        }
        return null;
      },
      set(handler) {
        for (const listener of this.listeners(method)) {
          if (listener[kForOnEventAttribute]) {
            this.removeListener(method, listener);
            break;
          }
        }
        if (typeof handler !== 'function') return;
        this.addEventListener(method, handler, {
          [kForOnEventAttribute]: true,
        });
      },
    });
  });
  WebSocket.prototype.addEventListener = addEventListener;
  WebSocket.prototype.removeEventListener = removeEventListener;
  module.exports = WebSocket;
  function initAsClient(websocket, address, protocols, options) {
    const opts = {
      allowSynchronousEvents: true,
      autoPong: true,
      protocolVersion: protocolVersions[1],
      maxPayload: 100 * 1024 * 1024,
      skipUTF8Validation: false,
      perMessageDeflate: true,
      followRedirects: false,
      maxRedirects: 10,
      ...options,
      socketPath: undefined,
      hostname: undefined,
      protocol: undefined,
      timeout: undefined,
      method: 'GET',
      host: undefined,
      path: undefined,
      port: undefined,
    };
    websocket._autoPong = opts.autoPong;
    if (!protocolVersions.includes(opts.protocolVersion)) {
      throw new RangeError(
        `Unsupported protocol version: ${opts.protocolVersion} ` +
          `(supported versions: ${protocolVersions.join(', ')})`
      );
    }
    let parsedUrl;
    if (address instanceof URL2) {
      parsedUrl = address;
    } else {
      try {
        parsedUrl = new URL2(address);
      } catch (e) {
        throw new SyntaxError(`Invalid URL: ${address}`);
      }
    }
    if (parsedUrl.protocol === 'http:') {
      parsedUrl.protocol = 'ws:';
    } else if (parsedUrl.protocol === 'https:') {
      parsedUrl.protocol = 'wss:';
    }
    websocket._url = parsedUrl.href;
    const isSecure = parsedUrl.protocol === 'wss:';
    const isIpcUrl = parsedUrl.protocol === 'ws+unix:';
    let invalidUrlMessage;
    if (parsedUrl.protocol !== 'ws:' && !isSecure && !isIpcUrl) {
      invalidUrlMessage =
        `The URL's protocol must be one of "ws:", "wss:", ` +
        '"http:", "https:", or "ws+unix:"';
    } else if (isIpcUrl && !parsedUrl.pathname) {
      invalidUrlMessage = "The URL's pathname is empty";
    } else if (parsedUrl.hash) {
      invalidUrlMessage = 'The URL contains a fragment identifier';
    }
    if (invalidUrlMessage) {
      const err = new SyntaxError(invalidUrlMessage);
      if (websocket._redirects === 0) {
        throw err;
      } else {
        emitErrorAndClose(websocket, err);
        return;
      }
    }
    const defaultPort = isSecure ? 443 : 80;
    const key = randomBytes(16).toString('base64');
    const request = isSecure ? https.request : http.request;
    const protocolSet = new Set();
    let perMessageDeflate;
    opts.createConnection =
      opts.createConnection || (isSecure ? tlsConnect : netConnect);
    opts.defaultPort = opts.defaultPort || defaultPort;
    opts.port = parsedUrl.port || defaultPort;
    opts.host = parsedUrl.hostname.startsWith('[')
      ? parsedUrl.hostname.slice(1, -1)
      : parsedUrl.hostname;
    opts.headers = {
      ...opts.headers,
      'Sec-WebSocket-Version': opts.protocolVersion,
      'Sec-WebSocket-Key': key,
      Connection: 'Upgrade',
      Upgrade: 'websocket',
    };
    opts.path = parsedUrl.pathname + parsedUrl.search;
    opts.timeout = opts.handshakeTimeout;
    if (opts.perMessageDeflate) {
      perMessageDeflate = new PerMessageDeflate(
        opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
        false,
        opts.maxPayload
      );
      opts.headers['Sec-WebSocket-Extensions'] = format({
        [PerMessageDeflate.extensionName]: perMessageDeflate.offer(),
      });
    }
    if (protocols.length) {
      for (const protocol of protocols) {
        if (
          typeof protocol !== 'string' ||
          !subprotocolRegex.test(protocol) ||
          protocolSet.has(protocol)
        ) {
          throw new SyntaxError(
            'An invalid or duplicated subprotocol was specified'
          );
        }
        protocolSet.add(protocol);
      }
      opts.headers['Sec-WebSocket-Protocol'] = protocols.join(',');
    }
    if (opts.origin) {
      if (opts.protocolVersion < 13) {
        opts.headers['Sec-WebSocket-Origin'] = opts.origin;
      } else {
        opts.headers.Origin = opts.origin;
      }
    }
    if (parsedUrl.username || parsedUrl.password) {
      opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
    }
    if (isIpcUrl) {
      const parts = opts.path.split(':');
      opts.socketPath = parts[0];
      opts.path = parts[1];
    }
    let req;
    if (opts.followRedirects) {
      if (websocket._redirects === 0) {
        websocket._originalIpc = isIpcUrl;
        websocket._originalSecure = isSecure;
        websocket._originalHostOrSocketPath = isIpcUrl
          ? opts.socketPath
          : parsedUrl.host;
        const headers = options && options.headers;
        options = { ...options, headers: {} };
        if (headers) {
          for (const [key2, value] of Object.entries(headers)) {
            options.headers[key2.toLowerCase()] = value;
          }
        }
      } else if (websocket.listenerCount('redirect') === 0) {
        const isSameHost = isIpcUrl
          ? websocket._originalIpc
            ? opts.socketPath === websocket._originalHostOrSocketPath
            : false
          : websocket._originalIpc
            ? false
            : parsedUrl.host === websocket._originalHostOrSocketPath;
        if (!isSameHost || (websocket._originalSecure && !isSecure)) {
          delete opts.headers.authorization;
          delete opts.headers.cookie;
          if (!isSameHost) delete opts.headers.host;
          opts.auth = undefined;
        }
      }
      if (opts.auth && !options.headers.authorization) {
        options.headers.authorization =
          'Basic ' + Buffer.from(opts.auth).toString('base64');
      }
      req = websocket._req = request(opts);
      if (websocket._redirects) {
        websocket.emit('redirect', websocket.url, req);
      }
    } else {
      req = websocket._req = request(opts);
    }
    if (opts.timeout) {
      req.on('timeout', () => {
        abortHandshake(websocket, req, 'Opening handshake has timed out');
      });
    }
    req.on('error', (err) => {
      if (req === null || req[kAborted]) return;
      req = websocket._req = null;
      emitErrorAndClose(websocket, err);
    });
    req.on('response', (res) => {
      const location = res.headers.location;
      const statusCode = res.statusCode;
      if (
        location &&
        opts.followRedirects &&
        statusCode >= 300 &&
        statusCode < 400
      ) {
        if (++websocket._redirects > opts.maxRedirects) {
          abortHandshake(websocket, req, 'Maximum redirects exceeded');
          return;
        }
        req.abort();
        let addr;
        try {
          addr = new URL2(location, address);
        } catch (e) {
          const err = new SyntaxError(`Invalid URL: ${location}`);
          emitErrorAndClose(websocket, err);
          return;
        }
        initAsClient(websocket, addr, protocols, options);
      } else if (!websocket.emit('unexpected-response', req, res)) {
        abortHandshake(
          websocket,
          req,
          `Unexpected server response: ${res.statusCode}`
        );
      }
    });
    req.on('upgrade', (res, socket, head) => {
      websocket.emit('upgrade', res);
      if (websocket.readyState !== WebSocket.CONNECTING) return;
      req = websocket._req = null;
      const upgrade = res.headers.upgrade;
      if (upgrade === undefined || upgrade.toLowerCase() !== 'websocket') {
        abortHandshake(websocket, socket, 'Invalid Upgrade header');
        return;
      }
      const digest = createHash('sha1')
        .update(key + GUID)
        .digest('base64');
      if (res.headers['sec-websocket-accept'] !== digest) {
        abortHandshake(
          websocket,
          socket,
          'Invalid Sec-WebSocket-Accept header'
        );
        return;
      }
      const serverProt = res.headers['sec-websocket-protocol'];
      let protError;
      if (serverProt !== undefined) {
        if (!protocolSet.size) {
          protError = 'Server sent a subprotocol but none was requested';
        } else if (!protocolSet.has(serverProt)) {
          protError = 'Server sent an invalid subprotocol';
        }
      } else if (protocolSet.size) {
        protError = 'Server sent no subprotocol';
      }
      if (protError) {
        abortHandshake(websocket, socket, protError);
        return;
      }
      if (serverProt) websocket._protocol = serverProt;
      const secWebSocketExtensions = res.headers['sec-websocket-extensions'];
      if (secWebSocketExtensions !== undefined) {
        if (!perMessageDeflate) {
          const message =
            'Server sent a Sec-WebSocket-Extensions header but no extension ' +
            'was requested';
          abortHandshake(websocket, socket, message);
          return;
        }
        let extensions;
        try {
          extensions = parse(secWebSocketExtensions);
        } catch (err) {
          const message = 'Invalid Sec-WebSocket-Extensions header';
          abortHandshake(websocket, socket, message);
          return;
        }
        const extensionNames = Object.keys(extensions);
        if (
          extensionNames.length !== 1 ||
          extensionNames[0] !== PerMessageDeflate.extensionName
        ) {
          const message =
            'Server indicated an extension that was not requested';
          abortHandshake(websocket, socket, message);
          return;
        }
        try {
          perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
        } catch (err) {
          const message = 'Invalid Sec-WebSocket-Extensions header';
          abortHandshake(websocket, socket, message);
          return;
        }
        websocket._extensions[PerMessageDeflate.extensionName] =
          perMessageDeflate;
      }
      websocket.setSocket(socket, head, {
        allowSynchronousEvents: opts.allowSynchronousEvents,
        generateMask: opts.generateMask,
        maxPayload: opts.maxPayload,
        skipUTF8Validation: opts.skipUTF8Validation,
      });
    });
    if (opts.finishRequest) {
      opts.finishRequest(req, websocket);
    } else {
      req.end();
    }
  }
  function emitErrorAndClose(websocket, err) {
    websocket._readyState = WebSocket.CLOSING;
    websocket._errorEmitted = true;
    websocket.emit('error', err);
    websocket.emitClose();
  }
  function netConnect(options) {
    options.path = options.socketPath;
    return net.connect(options);
  }
  function tlsConnect(options) {
    options.path = undefined;
    if (!options.servername && options.servername !== '') {
      options.servername = net.isIP(options.host) ? '' : options.host;
    }
    return tls.connect(options);
  }
  function abortHandshake(websocket, stream, message) {
    websocket._readyState = WebSocket.CLOSING;
    const err = new Error(message);
    Error.captureStackTrace(err, abortHandshake);
    if (stream.setHeader) {
      stream[kAborted] = true;
      stream.abort();
      if (stream.socket && !stream.socket.destroyed) {
        stream.socket.destroy();
      }
      process.nextTick(emitErrorAndClose, websocket, err);
    } else {
      stream.destroy(err);
      stream.once('error', websocket.emit.bind(websocket, 'error'));
      stream.once('close', websocket.emitClose.bind(websocket));
    }
  }
  function sendAfterClose(websocket, data, cb) {
    if (data) {
      const length = isBlob(data) ? data.size : toBuffer(data).length;
      if (websocket._socket) websocket._sender._bufferedBytes += length;
      else websocket._bufferedAmount += length;
    }
    if (cb) {
      const err = new Error(
        `WebSocket is not open: readyState ${websocket.readyState} ` +
          `(${readyStates[websocket.readyState]})`
      );
      process.nextTick(cb, err);
    }
  }
  function receiverOnConclude(code, reason) {
    const websocket = this[kWebSocket];
    websocket._closeFrameReceived = true;
    websocket._closeMessage = reason;
    websocket._closeCode = code;
    if (websocket._socket[kWebSocket] === undefined) return;
    websocket._socket.removeListener('data', socketOnData);
    process.nextTick(resume, websocket._socket);
    if (code === 1005) websocket.close();
    else websocket.close(code, reason);
  }
  function receiverOnDrain() {
    const websocket = this[kWebSocket];
    if (!websocket.isPaused) websocket._socket.resume();
  }
  function receiverOnError(err) {
    const websocket = this[kWebSocket];
    if (websocket._socket[kWebSocket] !== undefined) {
      websocket._socket.removeListener('data', socketOnData);
      process.nextTick(resume, websocket._socket);
      websocket.close(err[kStatusCode]);
    }
    if (!websocket._errorEmitted) {
      websocket._errorEmitted = true;
      websocket.emit('error', err);
    }
  }
  function receiverOnFinish() {
    this[kWebSocket].emitClose();
  }
  function receiverOnMessage(data, isBinary) {
    this[kWebSocket].emit('message', data, isBinary);
  }
  function receiverOnPing(data) {
    const websocket = this[kWebSocket];
    if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
    websocket.emit('ping', data);
  }
  function receiverOnPong(data) {
    this[kWebSocket].emit('pong', data);
  }
  function resume(stream) {
    stream.resume();
  }
  function senderOnError(err) {
    const websocket = this[kWebSocket];
    if (websocket.readyState === WebSocket.CLOSED) return;
    if (websocket.readyState === WebSocket.OPEN) {
      websocket._readyState = WebSocket.CLOSING;
      setCloseTimer(websocket);
    }
    this._socket.end();
    if (!websocket._errorEmitted) {
      websocket._errorEmitted = true;
      websocket.emit('error', err);
    }
  }
  function setCloseTimer(websocket) {
    websocket._closeTimer = setTimeout(
      websocket._socket.destroy.bind(websocket._socket),
      closeTimeout
    );
  }
  function socketOnClose() {
    const websocket = this[kWebSocket];
    this.removeListener('close', socketOnClose);
    this.removeListener('data', socketOnData);
    this.removeListener('end', socketOnEnd);
    websocket._readyState = WebSocket.CLOSING;
    let chunk;
    if (
      !this._readableState.endEmitted &&
      !websocket._closeFrameReceived &&
      !websocket._receiver._writableState.errorEmitted &&
      (chunk = websocket._socket.read()) !== null
    ) {
      websocket._receiver.write(chunk);
    }
    websocket._receiver.end();
    this[kWebSocket] = undefined;
    clearTimeout(websocket._closeTimer);
    if (
      websocket._receiver._writableState.finished ||
      websocket._receiver._writableState.errorEmitted
    ) {
      websocket.emitClose();
    } else {
      websocket._receiver.on('error', receiverOnFinish);
      websocket._receiver.on('finish', receiverOnFinish);
    }
  }
  function socketOnData(chunk) {
    if (!this[kWebSocket]._receiver.write(chunk)) {
      this.pause();
    }
  }
  function socketOnEnd() {
    const websocket = this[kWebSocket];
    websocket._readyState = WebSocket.CLOSING;
    websocket._receiver.end();
    this.end();
  }
  function socketOnError() {
    const websocket = this[kWebSocket];
    this.removeListener('error', socketOnError);
    this.on('error', NOOP);
    if (websocket) {
      websocket._readyState = WebSocket.CLOSING;
      this.destroy();
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS((exports, module) => {
  var WebSocket = require_websocket();
  var { Duplex } = __require('stream');
  function emitClose(stream) {
    stream.emit('close');
  }
  function duplexOnEnd() {
    if (!this.destroyed && this._writableState.finished) {
      this.destroy();
    }
  }
  function duplexOnError(err) {
    this.removeListener('error', duplexOnError);
    this.destroy();
    if (this.listenerCount('error') === 0) {
      this.emit('error', err);
    }
  }
  function createWebSocketStream(ws, options) {
    let terminateOnDestroy = true;
    const duplex = new Duplex({
      ...options,
      autoDestroy: false,
      emitClose: false,
      objectMode: false,
      writableObjectMode: false,
    });
    ws.on('message', function message(msg, isBinary) {
      const data =
        !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
      if (!duplex.push(data)) ws.pause();
    });
    ws.once('error', function error(err) {
      if (duplex.destroyed) return;
      terminateOnDestroy = false;
      duplex.destroy(err);
    });
    ws.once('close', function close() {
      if (duplex.destroyed) return;
      duplex.push(null);
    });
    duplex._destroy = function (err, callback) {
      if (ws.readyState === ws.CLOSED) {
        callback(err);
        process.nextTick(emitClose, duplex);
        return;
      }
      let called = false;
      ws.once('error', function error(err2) {
        called = true;
        callback(err2);
      });
      ws.once('close', function close() {
        if (!called) callback(err);
        process.nextTick(emitClose, duplex);
      });
      if (terminateOnDestroy) ws.terminate();
    };
    duplex._final = function (callback) {
      if (ws.readyState === ws.CONNECTING) {
        ws.once('open', function open() {
          duplex._final(callback);
        });
        return;
      }
      if (ws._socket === null) return;
      if (ws._socket._writableState.finished) {
        callback();
        if (duplex._readableState.endEmitted) duplex.destroy();
      } else {
        ws._socket.once('finish', function finish() {
          callback();
        });
        ws.close();
      }
    };
    duplex._read = function () {
      if (ws.isPaused) ws.resume();
    };
    duplex._write = function (chunk, encoding, callback) {
      if (ws.readyState === ws.CONNECTING) {
        ws.once('open', function open() {
          duplex._write(chunk, encoding, callback);
        });
        return;
      }
      ws.send(chunk, callback);
    };
    duplex.on('end', duplexOnEnd);
    duplex.on('error', duplexOnError);
    return duplex;
  }
  module.exports = createWebSocketStream;
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS((exports, module) => {
  var { tokenChars } = require_validation();
  function parse(header) {
    const protocols = new Set();
    let start = -1;
    let end = -1;
    let i = 0;
    for (i; i < header.length; i++) {
      const code = header.charCodeAt(i);
      if (end === -1 && tokenChars[code] === 1) {
        if (start === -1) start = i;
      } else if (i !== 0 && (code === 32 || code === 9)) {
        if (end === -1 && start !== -1) end = i;
      } else if (code === 44) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (end === -1) end = i;
        const protocol2 = header.slice(start, end);
        if (protocols.has(protocol2)) {
          throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
        }
        protocols.add(protocol2);
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    }
    if (start === -1 || end !== -1) {
      throw new SyntaxError('Unexpected end of input');
    }
    const protocol = header.slice(start, i);
    if (protocols.has(protocol)) {
      throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
    }
    protocols.add(protocol);
    return protocols;
  }
  module.exports = { parse };
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS((exports, module) => {
  var EventEmitter = __require('events');
  var http = __require('http');
  var { Duplex } = __require('stream');
  var { createHash } = __require('crypto');
  var extension = require_extension();
  var PerMessageDeflate = require_permessage_deflate();
  var subprotocol = require_subprotocol();
  var WebSocket = require_websocket();
  var { GUID, kWebSocket } = require_constants();
  var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
  var RUNNING = 0;
  var CLOSING = 1;
  var CLOSED = 2;

  class WebSocketServer extends EventEmitter {
    constructor(options, callback) {
      super();
      options = {
        allowSynchronousEvents: true,
        autoPong: true,
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: false,
        handleProtocols: null,
        clientTracking: true,
        verifyClient: null,
        noServer: false,
        backlog: null,
        server: null,
        host: null,
        path: null,
        port: null,
        WebSocket,
        ...options,
      };
      if (
        (options.port == null && !options.server && !options.noServer) ||
        (options.port != null && (options.server || options.noServer)) ||
        (options.server && options.noServer)
      ) {
        throw new TypeError(
          'One and only one of the "port", "server", or "noServer" options ' +
            'must be specified'
        );
      }
      if (options.port != null) {
        this._server = http.createServer((req, res) => {
          const body = http.STATUS_CODES[426];
          res.writeHead(426, {
            'Content-Length': body.length,
            'Content-Type': 'text/plain',
          });
          res.end(body);
        });
        this._server.listen(
          options.port,
          options.host,
          options.backlog,
          callback
        );
      } else if (options.server) {
        this._server = options.server;
      }
      if (this._server) {
        const emitConnection = this.emit.bind(this, 'connection');
        this._removeListeners = addListeners(this._server, {
          listening: this.emit.bind(this, 'listening'),
          error: this.emit.bind(this, 'error'),
          upgrade: (req, socket, head) => {
            this.handleUpgrade(req, socket, head, emitConnection);
          },
        });
      }
      if (options.perMessageDeflate === true) options.perMessageDeflate = {};
      if (options.clientTracking) {
        this.clients = new Set();
        this._shouldEmitClose = false;
      }
      this.options = options;
      this._state = RUNNING;
    }
    address() {
      if (this.options.noServer) {
        throw new Error('The server is operating in "noServer" mode');
      }
      if (!this._server) return null;
      return this._server.address();
    }
    close(cb) {
      if (this._state === CLOSED) {
        if (cb) {
          this.once('close', () => {
            cb(new Error('The server is not running'));
          });
        }
        process.nextTick(emitClose, this);
        return;
      }
      if (cb) this.once('close', cb);
      if (this._state === CLOSING) return;
      this._state = CLOSING;
      if (this.options.noServer || this.options.server) {
        if (this._server) {
          this._removeListeners();
          this._removeListeners = this._server = null;
        }
        if (this.clients) {
          if (!this.clients.size) {
            process.nextTick(emitClose, this);
          } else {
            this._shouldEmitClose = true;
          }
        } else {
          process.nextTick(emitClose, this);
        }
      } else {
        const server = this._server;
        this._removeListeners();
        this._removeListeners = this._server = null;
        server.close(() => {
          emitClose(this);
        });
      }
    }
    shouldHandle(req) {
      if (this.options.path) {
        const index = req.url.indexOf('?');
        const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
        if (pathname !== this.options.path) return false;
      }
      return true;
    }
    handleUpgrade(req, socket, head, cb) {
      socket.on('error', socketOnError);
      const key = req.headers['sec-websocket-key'];
      const upgrade = req.headers.upgrade;
      const version = +req.headers['sec-websocket-version'];
      if (req.method !== 'GET') {
        const message = 'Invalid HTTP method';
        abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
        return;
      }
      if (upgrade === undefined || upgrade.toLowerCase() !== 'websocket') {
        const message = 'Invalid Upgrade header';
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
      if (key === undefined || !keyRegex.test(key)) {
        const message = 'Missing or invalid Sec-WebSocket-Key header';
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
      if (version !== 13 && version !== 8) {
        const message = 'Missing or invalid Sec-WebSocket-Version header';
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
          'Sec-WebSocket-Version': '13, 8',
        });
        return;
      }
      if (!this.shouldHandle(req)) {
        abortHandshake(socket, 400);
        return;
      }
      const secWebSocketProtocol = req.headers['sec-websocket-protocol'];
      let protocols = new Set();
      if (secWebSocketProtocol !== undefined) {
        try {
          protocols = subprotocol.parse(secWebSocketProtocol);
        } catch (err) {
          const message = 'Invalid Sec-WebSocket-Protocol header';
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
      }
      const secWebSocketExtensions = req.headers['sec-websocket-extensions'];
      const extensions = {};
      if (
        this.options.perMessageDeflate &&
        secWebSocketExtensions !== undefined
      ) {
        const perMessageDeflate = new PerMessageDeflate(
          this.options.perMessageDeflate,
          true,
          this.options.maxPayload
        );
        try {
          const offers = extension.parse(secWebSocketExtensions);
          if (offers[PerMessageDeflate.extensionName]) {
            perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
            extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
          }
        } catch (err) {
          const message =
            'Invalid or unacceptable Sec-WebSocket-Extensions header';
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
      }
      if (this.options.verifyClient) {
        const info = {
          origin:
            req.headers[`${version === 8 ? 'sec-websocket-origin' : 'origin'}`],
          secure: !!(req.socket.authorized || req.socket.encrypted),
          req,
        };
        if (this.options.verifyClient.length === 2) {
          this.options.verifyClient(
            info,
            (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            }
          );
          return;
        }
        if (!this.options.verifyClient(info))
          return abortHandshake(socket, 401);
      }
      this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
    }
    completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
      if (!socket.readable || !socket.writable) return socket.destroy();
      if (socket[kWebSocket]) {
        throw new Error(
          'server.handleUpgrade() was called more than once with the same ' +
            'socket, possibly due to a misconfiguration'
        );
      }
      if (this._state > RUNNING) return abortHandshake(socket, 503);
      const digest = createHash('sha1')
        .update(key + GUID)
        .digest('base64');
      const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${digest}`,
      ];
      const ws = new this.options.WebSocket(null, undefined, this.options);
      if (protocols.size) {
        const protocol = this.options.handleProtocols
          ? this.options.handleProtocols(protocols, req)
          : protocols.values().next().value;
        if (protocol) {
          headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
          ws._protocol = protocol;
        }
      }
      if (extensions[PerMessageDeflate.extensionName]) {
        const params = extensions[PerMessageDeflate.extensionName].params;
        const value = extension.format({
          [PerMessageDeflate.extensionName]: [params],
        });
        headers.push(`Sec-WebSocket-Extensions: ${value}`);
        ws._extensions = extensions;
      }
      this.emit('headers', headers, req);
      socket.write(
        headers
          .concat(`\r
`)
          .join(`\r
`)
      );
      socket.removeListener('error', socketOnError);
      ws.setSocket(socket, head, {
        allowSynchronousEvents: this.options.allowSynchronousEvents,
        maxPayload: this.options.maxPayload,
        skipUTF8Validation: this.options.skipUTF8Validation,
      });
      if (this.clients) {
        this.clients.add(ws);
        ws.on('close', () => {
          this.clients.delete(ws);
          if (this._shouldEmitClose && !this.clients.size) {
            process.nextTick(emitClose, this);
          }
        });
      }
      cb(ws, req);
    }
  }
  module.exports = WebSocketServer;
  function addListeners(server, map) {
    for (const event of Object.keys(map)) server.on(event, map[event]);
    return function removeListeners() {
      for (const event of Object.keys(map)) {
        server.removeListener(event, map[event]);
      }
    };
  }
  function emitClose(server) {
    server._state = CLOSED;
    server.emit('close');
  }
  function socketOnError() {
    this.destroy();
  }
  function abortHandshake(socket, code, message, headers) {
    message = message || http.STATUS_CODES[code];
    headers = {
      Connection: 'close',
      'Content-Type': 'text/html',
      'Content-Length': Buffer.byteLength(message),
      ...headers,
    };
    socket.once('finish', socket.destroy);
    socket.end(
      `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` +
        Object.keys(headers)
          .map((h) => `${h}: ${headers[h]}`)
          .join(`\r
`) +
        `\r
\r
` +
        message
    );
  }
  function abortHandshakeOrEmitwsClientError(
    server,
    req,
    socket,
    code,
    message,
    headers
  ) {
    if (server.listenerCount('wsClientError')) {
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
      server.emit('wsClientError', err, socket, req);
    } else {
      abortHandshake(socket, code, message, headers);
    }
  }
});

// node_modules/react-devtools-core/dist/backend.js
var require_backend = __commonJS((exports, module) => {
  (function webpackUniversalModuleDefinition(root, factory) {
    if (typeof exports === 'object' && typeof module === 'object')
      module.exports = factory();
    else if (typeof define === 'function' && define.amd) define([], factory);
    else if (typeof exports === 'object')
      exports['ReactDevToolsBackend'] = factory();
    else root['ReactDevToolsBackend'] = factory();
  })(self, () => {
    return (() => {
      var __webpack_modules__ = {
        786: (__unused_webpack_module, exports2, __webpack_require__2) => {
          var __webpack_unused_export__;
          function _typeof(obj) {
            '@babel/helpers - typeof';
            if (
              typeof Symbol === 'function' &&
              typeof Symbol.iterator === 'symbol'
            ) {
              _typeof = function _typeof(obj2) {
                return typeof obj2;
              };
            } else {
              _typeof = function _typeof(obj2) {
                return obj2 &&
                  typeof Symbol === 'function' &&
                  obj2.constructor === Symbol &&
                  obj2 !== Symbol.prototype
                  ? 'symbol'
                  : typeof obj2;
              };
            }
            return _typeof(obj);
          }
          var ErrorStackParser = __webpack_require__2(206),
            React = __webpack_require__2(189),
            assign = Object.assign,
            ReactSharedInternals =
              React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
            REACT_CONTEXT_TYPE = Symbol.for('react.context'),
            REACT_MEMO_CACHE_SENTINEL = Symbol.for('react.memo_cache_sentinel'),
            hasOwnProperty = Object.prototype.hasOwnProperty,
            hookLog = [],
            primitiveStackCache = null;
          function getPrimitiveStackCache() {
            if (primitiveStackCache === null) {
              var cache = new Map();
              try {
                Dispatcher.useContext({
                  _currentValue: null,
                });
                Dispatcher.useState(null);
                Dispatcher.useReducer(function (s) {
                  return s;
                }, null);
                Dispatcher.useRef(null);
                typeof Dispatcher.useCacheRefresh === 'function' &&
                  Dispatcher.useCacheRefresh();
                Dispatcher.useLayoutEffect(function () {});
                Dispatcher.useInsertionEffect(function () {});
                Dispatcher.useEffect(function () {});
                Dispatcher.useImperativeHandle(undefined, function () {
                  return null;
                });
                Dispatcher.useDebugValue(null);
                Dispatcher.useCallback(function () {});
                Dispatcher.useTransition();
                Dispatcher.useSyncExternalStore(
                  function () {
                    return function () {};
                  },
                  function () {
                    return null;
                  },
                  function () {
                    return null;
                  }
                );
                Dispatcher.useDeferredValue(null);
                Dispatcher.useMemo(function () {
                  return null;
                });
                Dispatcher.useOptimistic(null, function (s) {
                  return s;
                });
                Dispatcher.useFormState(function (s) {
                  return s;
                }, null);
                Dispatcher.useActionState(function (s) {
                  return s;
                }, null);
                Dispatcher.useHostTransitionStatus();
                typeof Dispatcher.useMemoCache === 'function' &&
                  Dispatcher.useMemoCache(0);
                if (typeof Dispatcher.use === 'function') {
                  Dispatcher.use({
                    $$typeof: REACT_CONTEXT_TYPE,
                    _currentValue: null,
                  });
                  Dispatcher.use({
                    then: function then() {},
                    status: 'fulfilled',
                    value: null,
                  });
                  try {
                    Dispatcher.use({
                      then: function then() {},
                    });
                  } catch (x) {}
                }
                Dispatcher.useId();
                typeof Dispatcher.useEffectEvent === 'function' &&
                  Dispatcher.useEffectEvent(function () {});
              } finally {
                var readHookLog = hookLog;
                hookLog = [];
              }
              for (var i = 0; i < readHookLog.length; i++) {
                var hook = readHookLog[i];
                cache.set(
                  hook.primitive,
                  ErrorStackParser.parse(hook.stackError)
                );
              }
              primitiveStackCache = cache;
            }
            return primitiveStackCache;
          }
          var currentFiber = null,
            currentHook = null,
            currentContextDependency = null;
          function nextHook() {
            var hook = currentHook;
            hook !== null && (currentHook = hook.next);
            return hook;
          }
          function readContext(context) {
            if (currentFiber === null) return context._currentValue;
            if (currentContextDependency === null)
              throw Error(
                'Context reads do not line up with context dependencies. This is a bug in React Debug Tools.'
              );
            hasOwnProperty.call(currentContextDependency, 'memoizedValue')
              ? ((context = currentContextDependency.memoizedValue),
                (currentContextDependency = currentContextDependency.next))
              : (context = context._currentValue);
            return context;
          }
          var SuspenseException = Error(
              "Suspense Exception: This is not a real error! It's an implementation detail of `use` to interrupt the current render. You must either rethrow it immediately, or move the `use` call outside of the `try/catch` block. Capturing without rethrowing will lead to unexpected behavior.\n\nTo handle async errors, wrap your component in an error boundary, or call the promise's `.catch` method and pass the result to `use`."
            ),
            Dispatcher = {
              readContext,
              use: function use(usable) {
                if (usable !== null && _typeof(usable) === 'object') {
                  if (typeof usable.then === 'function') {
                    switch (usable.status) {
                      case 'fulfilled':
                        var fulfilledValue = usable.value;
                        hookLog.push({
                          displayName: null,
                          primitive: 'Promise',
                          stackError: Error(),
                          value: fulfilledValue,
                          debugInfo:
                            usable._debugInfo === undefined
                              ? null
                              : usable._debugInfo,
                          dispatcherHookName: 'Use',
                        });
                        return fulfilledValue;
                      case 'rejected':
                        throw usable.reason;
                    }
                    hookLog.push({
                      displayName: null,
                      primitive: 'Unresolved',
                      stackError: Error(),
                      value: usable,
                      debugInfo:
                        usable._debugInfo === undefined
                          ? null
                          : usable._debugInfo,
                      dispatcherHookName: 'Use',
                    });
                    throw SuspenseException;
                  }
                  if (usable.$$typeof === REACT_CONTEXT_TYPE)
                    return (
                      (fulfilledValue = readContext(usable)),
                      hookLog.push({
                        displayName: usable.displayName || 'Context',
                        primitive: 'Context (use)',
                        stackError: Error(),
                        value: fulfilledValue,
                        debugInfo: null,
                        dispatcherHookName: 'Use',
                      }),
                      fulfilledValue
                    );
                }
                throw Error(
                  'An unsupported type was passed to use(): ' + String(usable)
                );
              },
              useCallback: function useCallback(callback) {
                var hook = nextHook();
                hookLog.push({
                  displayName: null,
                  primitive: 'Callback',
                  stackError: Error(),
                  value: hook !== null ? hook.memoizedState[0] : callback,
                  debugInfo: null,
                  dispatcherHookName: 'Callback',
                });
                return callback;
              },
              useContext: function useContext(context) {
                var value = readContext(context);
                hookLog.push({
                  displayName: context.displayName || null,
                  primitive: 'Context',
                  stackError: Error(),
                  value,
                  debugInfo: null,
                  dispatcherHookName: 'Context',
                });
                return value;
              },
              useEffect: function useEffect(create) {
                nextHook();
                hookLog.push({
                  displayName: null,
                  primitive: 'Effect',
                  stackError: Error(),
                  value: create,
                  debugInfo: null,
                  dispatcherHookName: 'Effect',
                });
              },
              useImperativeHandle: function useImperativeHandle(ref) {
                nextHook();
                var instance = undefined;
                ref !== null &&
                  _typeof(ref) === 'object' &&
                  (instance = ref.current);
                hookLog.push({
                  displayName: null,
                  primitive: 'ImperativeHandle',
                  stackError: Error(),
                  value: instance,
                  debugInfo: null,
                  dispatcherHookName: 'ImperativeHandle',
                });
              },
              useLayoutEffect: function useLayoutEffect(create) {
                nextHook();
                hookLog.push({
                  displayName: null,
                  primitive: 'LayoutEffect',
                  stackError: Error(),
                  value: create,
                  debugInfo: null,
                  dispatcherHookName: 'LayoutEffect',
                });
              },
              useInsertionEffect: function useInsertionEffect(create) {
                nextHook();
                hookLog.push({
                  displayName: null,
                  primitive: 'InsertionEffect',
                  stackError: Error(),
                  value: create,
                  debugInfo: null,
                  dispatcherHookName: 'InsertionEffect',
                });
              },
              useMemo: function useMemo(nextCreate) {
                var hook = nextHook();
                nextCreate =
                  hook !== null ? hook.memoizedState[0] : nextCreate();
                hookLog.push({
                  displayName: null,
                  primitive: 'Memo',
                  stackError: Error(),
                  value: nextCreate,
                  debugInfo: null,
                  dispatcherHookName: 'Memo',
                });
                return nextCreate;
              },
              useReducer: function useReducer(reducer, initialArg, init) {
                reducer = nextHook();
                initialArg =
                  reducer !== null
                    ? reducer.memoizedState
                    : init !== undefined
                      ? init(initialArg)
                      : initialArg;
                hookLog.push({
                  displayName: null,
                  primitive: 'Reducer',
                  stackError: Error(),
                  value: initialArg,
                  debugInfo: null,
                  dispatcherHookName: 'Reducer',
                });
                return [initialArg, function () {}];
              },
              useRef: function useRef(initialValue) {
                var hook = nextHook();
                initialValue =
                  hook !== null
                    ? hook.memoizedState
                    : {
                        current: initialValue,
                      };
                hookLog.push({
                  displayName: null,
                  primitive: 'Ref',
                  stackError: Error(),
                  value: initialValue.current,
                  debugInfo: null,
                  dispatcherHookName: 'Ref',
                });
                return initialValue;
              },
              useState: function useState(initialState) {
                var hook = nextHook();
                initialState =
                  hook !== null
                    ? hook.memoizedState
                    : typeof initialState === 'function'
                      ? initialState()
                      : initialState;
                hookLog.push({
                  displayName: null,
                  primitive: 'State',
                  stackError: Error(),
                  value: initialState,
                  debugInfo: null,
                  dispatcherHookName: 'State',
                });
                return [initialState, function () {}];
              },
              useDebugValue: function useDebugValue(value, formatterFn) {
                hookLog.push({
                  displayName: null,
                  primitive: 'DebugValue',
                  stackError: Error(),
                  value:
                    typeof formatterFn === 'function'
                      ? formatterFn(value)
                      : value,
                  debugInfo: null,
                  dispatcherHookName: 'DebugValue',
                });
              },
              useDeferredValue: function useDeferredValue(value) {
                var hook = nextHook();
                value = hook !== null ? hook.memoizedState : value;
                hookLog.push({
                  displayName: null,
                  primitive: 'DeferredValue',
                  stackError: Error(),
                  value,
                  debugInfo: null,
                  dispatcherHookName: 'DeferredValue',
                });
                return value;
              },
              useTransition: function useTransition() {
                var stateHook = nextHook();
                nextHook();
                stateHook =
                  stateHook !== null ? stateHook.memoizedState : false;
                hookLog.push({
                  displayName: null,
                  primitive: 'Transition',
                  stackError: Error(),
                  value: stateHook,
                  debugInfo: null,
                  dispatcherHookName: 'Transition',
                });
                return [stateHook, function () {}];
              },
              useSyncExternalStore: function useSyncExternalStore(
                subscribe,
                getSnapshot
              ) {
                nextHook();
                nextHook();
                subscribe = getSnapshot();
                hookLog.push({
                  displayName: null,
                  primitive: 'SyncExternalStore',
                  stackError: Error(),
                  value: subscribe,
                  debugInfo: null,
                  dispatcherHookName: 'SyncExternalStore',
                });
                return subscribe;
              },
              useId: function useId() {
                var hook = nextHook();
                hook = hook !== null ? hook.memoizedState : '';
                hookLog.push({
                  displayName: null,
                  primitive: 'Id',
                  stackError: Error(),
                  value: hook,
                  debugInfo: null,
                  dispatcherHookName: 'Id',
                });
                return hook;
              },
              useHostTransitionStatus: function useHostTransitionStatus() {
                var status = readContext({
                  _currentValue: null,
                });
                hookLog.push({
                  displayName: null,
                  primitive: 'HostTransitionStatus',
                  stackError: Error(),
                  value: status,
                  debugInfo: null,
                  dispatcherHookName: 'HostTransitionStatus',
                });
                return status;
              },
              useFormState: function useFormState(action, initialState) {
                var hook = nextHook();
                nextHook();
                nextHook();
                action = Error();
                var debugInfo = null,
                  error = null;
                if (hook !== null) {
                  if (
                    ((initialState = hook.memoizedState),
                    _typeof(initialState) === 'object' &&
                      initialState !== null &&
                      typeof initialState.then === 'function')
                  )
                    switch (initialState.status) {
                      case 'fulfilled':
                        var value = initialState.value;
                        debugInfo =
                          initialState._debugInfo === undefined
                            ? null
                            : initialState._debugInfo;
                        break;
                      case 'rejected':
                        error = initialState.reason;
                        break;
                      default:
                        (error = SuspenseException),
                          (debugInfo =
                            initialState._debugInfo === undefined
                              ? null
                              : initialState._debugInfo),
                          (value = initialState);
                    }
                  else value = initialState;
                } else value = initialState;
                hookLog.push({
                  displayName: null,
                  primitive: 'FormState',
                  stackError: action,
                  value,
                  debugInfo,
                  dispatcherHookName: 'FormState',
                });
                if (error !== null) throw error;
                return [value, function () {}, false];
              },
              useActionState: function useActionState(action, initialState) {
                var hook = nextHook();
                nextHook();
                nextHook();
                action = Error();
                var debugInfo = null,
                  error = null;
                if (hook !== null) {
                  if (
                    ((initialState = hook.memoizedState),
                    _typeof(initialState) === 'object' &&
                      initialState !== null &&
                      typeof initialState.then === 'function')
                  )
                    switch (initialState.status) {
                      case 'fulfilled':
                        var value = initialState.value;
                        debugInfo =
                          initialState._debugInfo === undefined
                            ? null
                            : initialState._debugInfo;
                        break;
                      case 'rejected':
                        error = initialState.reason;
                        break;
                      default:
                        (error = SuspenseException),
                          (debugInfo =
                            initialState._debugInfo === undefined
                              ? null
                              : initialState._debugInfo),
                          (value = initialState);
                    }
                  else value = initialState;
                } else value = initialState;
                hookLog.push({
                  displayName: null,
                  primitive: 'ActionState',
                  stackError: action,
                  value,
                  debugInfo,
                  dispatcherHookName: 'ActionState',
                });
                if (error !== null) throw error;
                return [value, function () {}, false];
              },
              useOptimistic: function useOptimistic(passthrough) {
                var hook = nextHook();
                passthrough = hook !== null ? hook.memoizedState : passthrough;
                hookLog.push({
                  displayName: null,
                  primitive: 'Optimistic',
                  stackError: Error(),
                  value: passthrough,
                  debugInfo: null,
                  dispatcherHookName: 'Optimistic',
                });
                return [passthrough, function () {}];
              },
              useMemoCache: function useMemoCache(size) {
                var fiber = currentFiber;
                if (fiber == null) return [];
                fiber =
                  fiber.updateQueue != null
                    ? fiber.updateQueue.memoCache
                    : null;
                if (fiber == null) return [];
                var data = fiber.data[fiber.index];
                if (data === undefined) {
                  data = fiber.data[fiber.index] = Array(size);
                  for (var i = 0; i < size; i++) {
                    data[i] = REACT_MEMO_CACHE_SENTINEL;
                  }
                }
                fiber.index++;
                return data;
              },
              useCacheRefresh: function useCacheRefresh() {
                var hook = nextHook();
                hookLog.push({
                  displayName: null,
                  primitive: 'CacheRefresh',
                  stackError: Error(),
                  value: hook !== null ? hook.memoizedState : function () {},
                  debugInfo: null,
                  dispatcherHookName: 'CacheRefresh',
                });
                return function () {};
              },
              useEffectEvent: function useEffectEvent(callback) {
                nextHook();
                hookLog.push({
                  displayName: null,
                  primitive: 'EffectEvent',
                  stackError: Error(),
                  value: callback,
                  debugInfo: null,
                  dispatcherHookName: 'EffectEvent',
                });
                return callback;
              },
            },
            DispatcherProxyHandler = {
              get: function get(target, prop) {
                if (target.hasOwnProperty(prop)) return target[prop];
                target = Error('Missing method in Dispatcher: ' + prop);
                target.name = 'ReactDebugToolsUnsupportedHookError';
                throw target;
              },
            },
            DispatcherProxy =
              typeof Proxy === 'undefined'
                ? Dispatcher
                : new Proxy(Dispatcher, DispatcherProxyHandler),
            mostLikelyAncestorIndex = 0;
          function findSharedIndex(hookStack, rootStack, rootIndex) {
            var source = rootStack[rootIndex].source,
              i = 0;
            a: for (; i < hookStack.length; i++) {
              if (hookStack[i].source === source) {
                for (
                  var a = rootIndex + 1, b = i + 1;
                  a < rootStack.length && b < hookStack.length;
                  a++, b++
                ) {
                  if (hookStack[b].source !== rootStack[a].source) continue a;
                }
                return i;
              }
            }
            return -1;
          }
          function isReactWrapper(functionName, wrapperName) {
            functionName = parseHookName(functionName);
            return wrapperName === 'HostTransitionStatus'
              ? functionName === wrapperName || functionName === 'FormStatus'
              : functionName === wrapperName;
          }
          function parseHookName(functionName) {
            if (!functionName) return '';
            var startIndex = functionName.lastIndexOf('[as ');
            if (startIndex !== -1)
              return parseHookName(functionName.slice(startIndex + 4, -1));
            startIndex = functionName.lastIndexOf('.');
            startIndex = startIndex === -1 ? 0 : startIndex + 1;
            functionName.slice(startIndex).startsWith('unstable_') &&
              (startIndex += 9);
            functionName.slice(startIndex).startsWith('experimental_') &&
              (startIndex += 13);
            if (functionName.slice(startIndex, startIndex + 3) === 'use') {
              if (functionName.length - startIndex === 3) return 'Use';
              startIndex += 3;
            }
            return functionName.slice(startIndex);
          }
          function buildTree(rootStack$jscomp$0, readHookLog) {
            for (
              var rootChildren = [],
                prevStack = null,
                levelChildren = rootChildren,
                nativeHookID = 0,
                stackOfChildren = [],
                i = 0;
              i < readHookLog.length;
              i++
            ) {
              var hook = readHookLog[i];
              var rootStack = rootStack$jscomp$0;
              var JSCompiler_inline_result = ErrorStackParser.parse(
                hook.stackError
              );
              b: {
                var hookStack = JSCompiler_inline_result,
                  rootIndex = findSharedIndex(
                    hookStack,
                    rootStack,
                    mostLikelyAncestorIndex
                  );
                if (rootIndex !== -1) rootStack = rootIndex;
                else {
                  for (
                    var i$jscomp$0 = 0;
                    i$jscomp$0 < rootStack.length && 5 > i$jscomp$0;
                    i$jscomp$0++
                  ) {
                    if (
                      ((rootIndex = findSharedIndex(
                        hookStack,
                        rootStack,
                        i$jscomp$0
                      )),
                      rootIndex !== -1)
                    ) {
                      mostLikelyAncestorIndex = i$jscomp$0;
                      rootStack = rootIndex;
                      break b;
                    }
                  }
                  rootStack = -1;
                }
              }
              b: {
                hookStack = JSCompiler_inline_result;
                rootIndex = getPrimitiveStackCache().get(hook.primitive);
                if (rootIndex !== undefined)
                  for (
                    i$jscomp$0 = 0;
                    i$jscomp$0 < rootIndex.length &&
                    i$jscomp$0 < hookStack.length;
                    i$jscomp$0++
                  ) {
                    if (
                      rootIndex[i$jscomp$0].source !==
                      hookStack[i$jscomp$0].source
                    ) {
                      i$jscomp$0 < hookStack.length - 1 &&
                        isReactWrapper(
                          hookStack[i$jscomp$0].functionName,
                          hook.dispatcherHookName
                        ) &&
                        i$jscomp$0++;
                      i$jscomp$0 < hookStack.length - 1 &&
                        isReactWrapper(
                          hookStack[i$jscomp$0].functionName,
                          hook.dispatcherHookName
                        ) &&
                        i$jscomp$0++;
                      hookStack = i$jscomp$0;
                      break b;
                    }
                  }
                hookStack = -1;
              }
              JSCompiler_inline_result =
                rootStack === -1 ||
                hookStack === -1 ||
                2 > rootStack - hookStack
                  ? hookStack === -1
                    ? [null, null]
                    : [JSCompiler_inline_result[hookStack - 1], null]
                  : [
                      JSCompiler_inline_result[hookStack - 1],
                      JSCompiler_inline_result.slice(hookStack, rootStack - 1),
                    ];
              hookStack = JSCompiler_inline_result[0];
              JSCompiler_inline_result = JSCompiler_inline_result[1];
              rootStack = hook.displayName;
              rootStack === null &&
                hookStack !== null &&
                (rootStack =
                  parseHookName(hookStack.functionName) ||
                  parseHookName(hook.dispatcherHookName));
              if (JSCompiler_inline_result !== null) {
                hookStack = 0;
                if (prevStack !== null) {
                  for (
                    ;
                    hookStack < JSCompiler_inline_result.length &&
                    hookStack < prevStack.length &&
                    JSCompiler_inline_result[
                      JSCompiler_inline_result.length - hookStack - 1
                    ].source ===
                      prevStack[prevStack.length - hookStack - 1].source;
                  ) {
                    hookStack++;
                  }
                  for (
                    prevStack = prevStack.length - 1;
                    prevStack > hookStack;
                    prevStack--
                  ) {
                    levelChildren = stackOfChildren.pop();
                  }
                }
                for (
                  prevStack = JSCompiler_inline_result.length - hookStack - 1;
                  1 <= prevStack;
                  prevStack--
                ) {
                  (hookStack = []),
                    (rootIndex = JSCompiler_inline_result[prevStack]),
                    (rootIndex = {
                      id: null,
                      isStateEditable: false,
                      name: parseHookName(
                        JSCompiler_inline_result[prevStack - 1].functionName
                      ),
                      value: undefined,
                      subHooks: hookStack,
                      debugInfo: null,
                      hookSource: {
                        lineNumber: rootIndex.lineNumber,
                        columnNumber: rootIndex.columnNumber,
                        functionName: rootIndex.functionName,
                        fileName: rootIndex.fileName,
                      },
                    }),
                    levelChildren.push(rootIndex),
                    stackOfChildren.push(levelChildren),
                    (levelChildren = hookStack);
                }
                prevStack = JSCompiler_inline_result;
              }
              hookStack = hook.primitive;
              rootIndex = hook.debugInfo;
              hook = {
                id:
                  hookStack === 'Context' ||
                  hookStack === 'Context (use)' ||
                  hookStack === 'DebugValue' ||
                  hookStack === 'Promise' ||
                  hookStack === 'Unresolved' ||
                  hookStack === 'HostTransitionStatus'
                    ? null
                    : nativeHookID++,
                isStateEditable:
                  hookStack === 'Reducer' || hookStack === 'State',
                name: rootStack || hookStack,
                value: hook.value,
                subHooks: [],
                debugInfo: rootIndex,
                hookSource: null,
              };
              rootStack = {
                lineNumber: null,
                functionName: null,
                fileName: null,
                columnNumber: null,
              };
              JSCompiler_inline_result &&
                1 <= JSCompiler_inline_result.length &&
                ((JSCompiler_inline_result = JSCompiler_inline_result[0]),
                (rootStack.lineNumber = JSCompiler_inline_result.lineNumber),
                (rootStack.functionName =
                  JSCompiler_inline_result.functionName),
                (rootStack.fileName = JSCompiler_inline_result.fileName),
                (rootStack.columnNumber =
                  JSCompiler_inline_result.columnNumber));
              hook.hookSource = rootStack;
              levelChildren.push(hook);
            }
            processDebugValues(rootChildren, null);
            return rootChildren;
          }
          function processDebugValues(hooksTree, parentHooksNode) {
            for (
              var debugValueHooksNodes = [], i = 0;
              i < hooksTree.length;
              i++
            ) {
              var hooksNode = hooksTree[i];
              hooksNode.name === 'DebugValue' && hooksNode.subHooks.length === 0
                ? (hooksTree.splice(i, 1),
                  i--,
                  debugValueHooksNodes.push(hooksNode))
                : processDebugValues(hooksNode.subHooks, hooksNode);
            }
            parentHooksNode !== null &&
              (debugValueHooksNodes.length === 1
                ? (parentHooksNode.value = debugValueHooksNodes[0].value)
                : 1 < debugValueHooksNodes.length &&
                  (parentHooksNode.value = debugValueHooksNodes.map(
                    function (_ref) {
                      return _ref.value;
                    }
                  )));
          }
          function handleRenderFunctionError(error) {
            if (error !== SuspenseException) {
              if (
                error instanceof Error &&
                error.name === 'ReactDebugToolsUnsupportedHookError'
              )
                throw error;
              var wrapperError = Error('Error rendering inspected component', {
                cause: error,
              });
              wrapperError.name = 'ReactDebugToolsRenderError';
              wrapperError.cause = error;
              throw wrapperError;
            }
          }
          function inspectHooks(renderFunction, props, currentDispatcher) {
            currentDispatcher == null &&
              (currentDispatcher = ReactSharedInternals);
            var previousDispatcher = currentDispatcher.H;
            currentDispatcher.H = DispatcherProxy;
            try {
              var ancestorStackError = Error();
              renderFunction(props);
            } catch (error) {
              handleRenderFunctionError(error);
            } finally {
              (renderFunction = hookLog),
                (hookLog = []),
                (currentDispatcher.H = previousDispatcher);
            }
            currentDispatcher = ErrorStackParser.parse(ancestorStackError);
            return buildTree(currentDispatcher, renderFunction);
          }
          function restoreContexts(contextMap) {
            contextMap.forEach(function (value, context) {
              return (context._currentValue = value);
            });
          }
          __webpack_unused_export__ = inspectHooks;
          exports2.inspectHooksOfFiber = function (fiber, currentDispatcher) {
            currentDispatcher == null &&
              (currentDispatcher = ReactSharedInternals);
            if (fiber.tag !== 0 && fiber.tag !== 15 && fiber.tag !== 11)
              throw Error(
                'Unknown Fiber. Needs to be a function component to inspect hooks.'
              );
            getPrimitiveStackCache();
            currentHook = fiber.memoizedState;
            currentFiber = fiber;
            if (hasOwnProperty.call(currentFiber, 'dependencies')) {
              var dependencies = currentFiber.dependencies;
              currentContextDependency =
                dependencies !== null ? dependencies.firstContext : null;
            } else if (hasOwnProperty.call(currentFiber, 'dependencies_old'))
              (dependencies = currentFiber.dependencies_old),
                (currentContextDependency =
                  dependencies !== null ? dependencies.firstContext : null);
            else if (hasOwnProperty.call(currentFiber, 'dependencies_new'))
              (dependencies = currentFiber.dependencies_new),
                (currentContextDependency =
                  dependencies !== null ? dependencies.firstContext : null);
            else if (hasOwnProperty.call(currentFiber, 'contextDependencies'))
              (dependencies = currentFiber.contextDependencies),
                (currentContextDependency =
                  dependencies !== null ? dependencies.first : null);
            else
              throw Error(
                'Unsupported React version. This is a bug in React Debug Tools.'
              );
            dependencies = fiber.type;
            var props = fiber.memoizedProps;
            if (
              dependencies !== fiber.elementType &&
              dependencies &&
              dependencies.defaultProps
            ) {
              props = assign({}, props);
              var defaultProps = dependencies.defaultProps;
              for (propName in defaultProps) {
                props[propName] === undefined &&
                  (props[propName] = defaultProps[propName]);
              }
            }
            var propName = new Map();
            try {
              if (
                currentContextDependency !== null &&
                !hasOwnProperty.call(currentContextDependency, 'memoizedValue')
              )
                for (defaultProps = fiber; defaultProps; ) {
                  if (defaultProps.tag === 10) {
                    var context = defaultProps.type;
                    context._context !== undefined &&
                      (context = context._context);
                    propName.has(context) ||
                      (propName.set(context, context._currentValue),
                      (context._currentValue =
                        defaultProps.memoizedProps.value));
                  }
                  defaultProps = defaultProps.return;
                }
              if (fiber.tag === 11) {
                var renderFunction = dependencies.render;
                context = props;
                var ref = fiber.ref;
                fiber = currentDispatcher;
                var previousDispatcher = fiber.H;
                fiber.H = DispatcherProxy;
                try {
                  var ancestorStackError = Error();
                  renderFunction(context, ref);
                } catch (error) {
                  handleRenderFunctionError(error);
                } finally {
                  var readHookLog = hookLog;
                  hookLog = [];
                  fiber.H = previousDispatcher;
                }
                var rootStack = ErrorStackParser.parse(ancestorStackError);
                return buildTree(rootStack, readHookLog);
              }
              return inspectHooks(dependencies, props, currentDispatcher);
            } finally {
              (currentContextDependency = currentHook = currentFiber = null),
                restoreContexts(propName);
            }
          };
        },
        987: (module2, __unused_webpack_exports, __webpack_require__2) => {
          if (true) {
            module2.exports = __webpack_require__2(786);
          } else {
          }
        },
        126: (__unused_webpack_module, exports2, __webpack_require__2) => {
          var process2 = __webpack_require__2(169);
          function _typeof(obj) {
            '@babel/helpers - typeof';
            if (
              typeof Symbol === 'function' &&
              typeof Symbol.iterator === 'symbol'
            ) {
              _typeof = function _typeof(obj2) {
                return typeof obj2;
              };
            } else {
              _typeof = function _typeof(obj2) {
                return obj2 &&
                  typeof Symbol === 'function' &&
                  obj2.constructor === Symbol &&
                  obj2 !== Symbol.prototype
                  ? 'symbol'
                  : typeof obj2;
              };
            }
            return _typeof(obj);
          }
          var REACT_ELEMENT_TYPE = Symbol.for('react.transitional.element'),
            REACT_PORTAL_TYPE = Symbol.for('react.portal'),
            REACT_FRAGMENT_TYPE = Symbol.for('react.fragment'),
            REACT_STRICT_MODE_TYPE = Symbol.for('react.strict_mode'),
            REACT_PROFILER_TYPE = Symbol.for('react.profiler'),
            REACT_CONSUMER_TYPE = Symbol.for('react.consumer'),
            REACT_CONTEXT_TYPE = Symbol.for('react.context'),
            REACT_FORWARD_REF_TYPE = Symbol.for('react.forward_ref'),
            REACT_SUSPENSE_TYPE = Symbol.for('react.suspense'),
            REACT_SUSPENSE_LIST_TYPE = Symbol.for('react.suspense_list'),
            REACT_MEMO_TYPE = Symbol.for('react.memo'),
            REACT_LAZY_TYPE = Symbol.for('react.lazy'),
            REACT_ACTIVITY_TYPE = Symbol.for('react.activity'),
            REACT_POSTPONE_TYPE = Symbol.for('react.postpone'),
            REACT_VIEW_TRANSITION_TYPE = Symbol.for('react.view_transition'),
            MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
          function getIteratorFn(maybeIterable) {
            if (maybeIterable === null || _typeof(maybeIterable) !== 'object')
              return null;
            maybeIterable =
              (MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL]) ||
              maybeIterable['@@iterator'];
            return typeof maybeIterable === 'function' ? maybeIterable : null;
          }
          var ReactNoopUpdateQueue = {
              isMounted: function isMounted() {
                return false;
              },
              enqueueForceUpdate: function enqueueForceUpdate() {},
              enqueueReplaceState: function enqueueReplaceState() {},
              enqueueSetState: function enqueueSetState() {},
            },
            assign = Object.assign,
            emptyObject = {};
          function Component(props, context, updater) {
            this.props = props;
            this.context = context;
            this.refs = emptyObject;
            this.updater = updater || ReactNoopUpdateQueue;
          }
          Component.prototype.isReactComponent = {};
          Component.prototype.setState = function (partialState, callback) {
            if (
              _typeof(partialState) !== 'object' &&
              typeof partialState !== 'function' &&
              partialState != null
            )
              throw Error(
                'takes an object of state variables to update or a function which returns an object of state variables.'
              );
            this.updater.enqueueSetState(
              this,
              partialState,
              callback,
              'setState'
            );
          };
          Component.prototype.forceUpdate = function (callback) {
            this.updater.enqueueForceUpdate(this, callback, 'forceUpdate');
          };
          function ComponentDummy() {}
          ComponentDummy.prototype = Component.prototype;
          function PureComponent(props, context, updater) {
            this.props = props;
            this.context = context;
            this.refs = emptyObject;
            this.updater = updater || ReactNoopUpdateQueue;
          }
          var pureComponentPrototype = (PureComponent.prototype =
            new ComponentDummy());
          pureComponentPrototype.constructor = PureComponent;
          assign(pureComponentPrototype, Component.prototype);
          pureComponentPrototype.isPureReactComponent = true;
          var isArrayImpl = Array.isArray;
          function noop() {}
          var ReactSharedInternals = {
              H: null,
              A: null,
              T: null,
              S: null,
              G: null,
            },
            hasOwnProperty = Object.prototype.hasOwnProperty;
          function ReactElement(type, key, self2, source, owner, props) {
            self2 = props.ref;
            return {
              $$typeof: REACT_ELEMENT_TYPE,
              type,
              key,
              ref: self2 !== undefined ? self2 : null,
              props,
            };
          }
          function cloneAndReplaceKey(oldElement, newKey) {
            return ReactElement(
              oldElement.type,
              newKey,
              undefined,
              undefined,
              undefined,
              oldElement.props
            );
          }
          function isValidElement(object) {
            return (
              _typeof(object) === 'object' &&
              object !== null &&
              object.$$typeof === REACT_ELEMENT_TYPE
            );
          }
          function escape(key) {
            var escaperLookup = {
              '=': '=0',
              ':': '=2',
            };
            return (
              '$' +
              key.replace(/[=:]/g, function (match) {
                return escaperLookup[match];
              })
            );
          }
          var userProvidedKeyEscapeRegex = /\/+/g;
          function getElementKey(element, index) {
            return _typeof(element) === 'object' &&
              element !== null &&
              element.key != null
              ? escape('' + element.key)
              : index.toString(36);
          }
          function resolveThenable(thenable) {
            switch (thenable.status) {
              case 'fulfilled':
                return thenable.value;
              case 'rejected':
                throw thenable.reason;
              default:
                switch (
                  (typeof thenable.status === 'string'
                    ? thenable.then(noop, noop)
                    : ((thenable.status = 'pending'),
                      thenable.then(
                        function (fulfilledValue) {
                          thenable.status === 'pending' &&
                            ((thenable.status = 'fulfilled'),
                            (thenable.value = fulfilledValue));
                        },
                        function (error) {
                          thenable.status === 'pending' &&
                            ((thenable.status = 'rejected'),
                            (thenable.reason = error));
                        }
                      )),
                  thenable.status)
                ) {
                  case 'fulfilled':
                    return thenable.value;
                  case 'rejected':
                    throw thenable.reason;
                }
            }
            throw thenable;
          }
          function mapIntoArray(
            children,
            array,
            escapedPrefix,
            nameSoFar,
            callback
          ) {
            var type = _typeof(children);
            if (type === 'undefined' || type === 'boolean') children = null;
            var invokeCallback = false;
            if (children === null) invokeCallback = true;
            else
              switch (type) {
                case 'bigint':
                case 'string':
                case 'number':
                  invokeCallback = true;
                  break;
                case 'object':
                  switch (children.$$typeof) {
                    case REACT_ELEMENT_TYPE:
                    case REACT_PORTAL_TYPE:
                      invokeCallback = true;
                      break;
                    case REACT_LAZY_TYPE:
                      return (
                        (invokeCallback = children._init),
                        mapIntoArray(
                          invokeCallback(children._payload),
                          array,
                          escapedPrefix,
                          nameSoFar,
                          callback
                        )
                      );
                  }
              }
            if (invokeCallback)
              return (
                (callback = callback(children)),
                (invokeCallback =
                  nameSoFar === ''
                    ? '.' + getElementKey(children, 0)
                    : nameSoFar),
                isArrayImpl(callback)
                  ? ((escapedPrefix = ''),
                    invokeCallback != null &&
                      (escapedPrefix =
                        invokeCallback.replace(
                          userProvidedKeyEscapeRegex,
                          '$&/'
                        ) + '/'),
                    mapIntoArray(
                      callback,
                      array,
                      escapedPrefix,
                      '',
                      function (c) {
                        return c;
                      }
                    ))
                  : callback != null &&
                    (isValidElement(callback) &&
                      (callback = cloneAndReplaceKey(
                        callback,
                        escapedPrefix +
                          (callback.key == null ||
                          (children && children.key === callback.key)
                            ? ''
                            : ('' + callback.key).replace(
                                userProvidedKeyEscapeRegex,
                                '$&/'
                              ) + '/') +
                          invokeCallback
                      )),
                    array.push(callback)),
                1
              );
            invokeCallback = 0;
            var nextNamePrefix = nameSoFar === '' ? '.' : nameSoFar + ':';
            if (isArrayImpl(children))
              for (var i = 0; i < children.length; i++) {
                (nameSoFar = children[i]),
                  (type = nextNamePrefix + getElementKey(nameSoFar, i)),
                  (invokeCallback += mapIntoArray(
                    nameSoFar,
                    array,
                    escapedPrefix,
                    type,
                    callback
                  ));
              }
            else if (((i = getIteratorFn(children)), typeof i === 'function'))
              for (
                children = i.call(children), i = 0;
                !(nameSoFar = children.next()).done;
              ) {
                (nameSoFar = nameSoFar.value),
                  (type = nextNamePrefix + getElementKey(nameSoFar, i++)),
                  (invokeCallback += mapIntoArray(
                    nameSoFar,
                    array,
                    escapedPrefix,
                    type,
                    callback
                  ));
              }
            else if (type === 'object') {
              if (typeof children.then === 'function')
                return mapIntoArray(
                  resolveThenable(children),
                  array,
                  escapedPrefix,
                  nameSoFar,
                  callback
                );
              array = String(children);
              throw Error(
                'Objects are not valid as a React child (found: ' +
                  (array === '[object Object]'
                    ? 'object with keys {' +
                      Object.keys(children).join(', ') +
                      '}'
                    : array) +
                  '). If you meant to render a collection of children, use an array instead.'
              );
            }
            return invokeCallback;
          }
          function mapChildren(children, func, context) {
            if (children == null) return children;
            var result = [],
              count = 0;
            mapIntoArray(children, result, '', '', function (child) {
              return func.call(context, child, count++);
            });
            return result;
          }
          function lazyInitializer(payload) {
            if (payload._status === -1) {
              var ctor = payload._result;
              ctor = ctor();
              ctor.then(
                function (moduleObject) {
                  if (payload._status === 0 || payload._status === -1)
                    (payload._status = 1), (payload._result = moduleObject);
                },
                function (error) {
                  if (payload._status === 0 || payload._status === -1)
                    (payload._status = 2), (payload._result = error);
                }
              );
              payload._status === -1 &&
                ((payload._status = 0), (payload._result = ctor));
            }
            if (payload._status === 1) return payload._result.default;
            throw payload._result;
          }
          function useOptimistic(passthrough, reducer) {
            return ReactSharedInternals.H.useOptimistic(passthrough, reducer);
          }
          var reportGlobalError =
            typeof reportError === 'function'
              ? reportError
              : function (error) {
                  if (
                    (typeof window === 'undefined'
                      ? 'undefined'
                      : _typeof(window)) === 'object' &&
                    typeof window.ErrorEvent === 'function'
                  ) {
                    var event = new window.ErrorEvent('error', {
                      bubbles: true,
                      cancelable: true,
                      message:
                        _typeof(error) === 'object' &&
                        error !== null &&
                        typeof error.message === 'string'
                          ? String(error.message)
                          : String(error),
                      error,
                    });
                    if (!window.dispatchEvent(event)) return;
                  } else if (
                    (typeof process2 === 'undefined'
                      ? 'undefined'
                      : _typeof(process2)) === 'object' &&
                    typeof process2.emit === 'function'
                  ) {
                    process2.emit('uncaughtException', error);
                    return;
                  }
                  console.error(error);
                };
          function startTransition(scope) {
            var prevTransition = ReactSharedInternals.T,
              currentTransition = {};
            currentTransition.types =
              prevTransition !== null ? prevTransition.types : null;
            currentTransition.gesture = null;
            ReactSharedInternals.T = currentTransition;
            try {
              var returnValue = scope(),
                onStartTransitionFinish = ReactSharedInternals.S;
              onStartTransitionFinish !== null &&
                onStartTransitionFinish(currentTransition, returnValue);
              _typeof(returnValue) === 'object' &&
                returnValue !== null &&
                typeof returnValue.then === 'function' &&
                returnValue.then(noop, reportGlobalError);
            } catch (error) {
              reportGlobalError(error);
            } finally {
              prevTransition !== null &&
                currentTransition.types !== null &&
                (prevTransition.types = currentTransition.types),
                (ReactSharedInternals.T = prevTransition);
            }
          }
          function addTransitionType(type) {
            var transition = ReactSharedInternals.T;
            if (transition !== null) {
              var transitionTypes = transition.types;
              transitionTypes === null
                ? (transition.types = [type])
                : transitionTypes.indexOf(type) === -1 &&
                  transitionTypes.push(type);
            } else startTransition(addTransitionType.bind(null, type));
          }
          exports2.Children = {
            map: mapChildren,
            forEach: function forEach(children, forEachFunc, forEachContext) {
              mapChildren(
                children,
                function () {
                  forEachFunc.apply(this, arguments);
                },
                forEachContext
              );
            },
            count: function count(children) {
              var n = 0;
              mapChildren(children, function () {
                n++;
              });
              return n;
            },
            toArray: function toArray(children) {
              return (
                mapChildren(children, function (child) {
                  return child;
                }) || []
              );
            },
            only: function only(children) {
              if (!isValidElement(children))
                throw Error(
                  'React.Children.only expected to receive a single React element child.'
                );
              return children;
            },
          };
          exports2.Component = Component;
          exports2.Fragment = REACT_FRAGMENT_TYPE;
          exports2.Profiler = REACT_PROFILER_TYPE;
          exports2.PureComponent = PureComponent;
          exports2.StrictMode = REACT_STRICT_MODE_TYPE;
          exports2.Suspense = REACT_SUSPENSE_TYPE;
          exports2.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE =
            ReactSharedInternals;
          exports2.__COMPILER_RUNTIME = {
            __proto__: null,
            c: function c(size) {
              return ReactSharedInternals.H.useMemoCache(size);
            },
          };
          exports2.cache = function (fn) {
            return function () {
              return fn.apply(null, arguments);
            };
          };
          exports2.cacheSignal = function () {
            return null;
          };
          exports2.cloneElement = function (element, config, children) {
            if (element === null || element === undefined)
              throw Error(
                'The argument must be a React element, but you passed ' +
                  element +
                  '.'
              );
            var props = assign({}, element.props),
              key = element.key,
              owner = undefined;
            if (config != null)
              for (propName in (config.ref !== undefined && (owner = undefined),
              config.key !== undefined && (key = '' + config.key),
              config)) {
                !hasOwnProperty.call(config, propName) ||
                  propName === 'key' ||
                  propName === '__self' ||
                  propName === '__source' ||
                  (propName === 'ref' && config.ref === undefined) ||
                  (props[propName] = config[propName]);
              }
            var propName = arguments.length - 2;
            if (propName === 1) props.children = children;
            else if (1 < propName) {
              for (var childArray = Array(propName), i = 0; i < propName; i++) {
                childArray[i] = arguments[i + 2];
              }
              props.children = childArray;
            }
            return ReactElement(
              element.type,
              key,
              undefined,
              undefined,
              owner,
              props
            );
          };
          exports2.createContext = function (defaultValue) {
            defaultValue = {
              $$typeof: REACT_CONTEXT_TYPE,
              _currentValue: defaultValue,
              _currentValue2: defaultValue,
              _threadCount: 0,
              Provider: null,
              Consumer: null,
            };
            defaultValue.Provider = defaultValue;
            defaultValue.Consumer = {
              $$typeof: REACT_CONSUMER_TYPE,
              _context: defaultValue,
            };
            return defaultValue;
          };
          exports2.createElement = function (type, config, children) {
            var propName,
              props = {},
              key = null;
            if (config != null)
              for (propName in (config.key !== undefined &&
                (key = '' + config.key),
              config)) {
                hasOwnProperty.call(config, propName) &&
                  propName !== 'key' &&
                  propName !== '__self' &&
                  propName !== '__source' &&
                  (props[propName] = config[propName]);
              }
            var childrenLength = arguments.length - 2;
            if (childrenLength === 1) props.children = children;
            else if (1 < childrenLength) {
              for (
                var childArray = Array(childrenLength), i = 0;
                i < childrenLength;
                i++
              ) {
                childArray[i] = arguments[i + 2];
              }
              props.children = childArray;
            }
            if (type && type.defaultProps)
              for (propName in ((childrenLength = type.defaultProps),
              childrenLength)) {
                props[propName] === undefined &&
                  (props[propName] = childrenLength[propName]);
              }
            return ReactElement(type, key, undefined, undefined, null, props);
          };
          exports2.createRef = function () {
            return {
              current: null,
            };
          };
          exports2.experimental_useEffectEvent = function (callback) {
            return ReactSharedInternals.H.useEffectEvent(callback);
          };
          exports2.experimental_useOptimistic = function (
            passthrough,
            reducer
          ) {
            return useOptimistic(passthrough, reducer);
          };
          exports2.forwardRef = function (render) {
            return {
              $$typeof: REACT_FORWARD_REF_TYPE,
              render,
            };
          };
          exports2.isValidElement = isValidElement;
          exports2.lazy = function (ctor) {
            return {
              $$typeof: REACT_LAZY_TYPE,
              _payload: {
                _status: -1,
                _result: ctor,
              },
              _init: lazyInitializer,
            };
          };
          exports2.memo = function (type, compare) {
            return {
              $$typeof: REACT_MEMO_TYPE,
              type,
              compare: compare === undefined ? null : compare,
            };
          };
          exports2.startTransition = startTransition;
          exports2.unstable_Activity = REACT_ACTIVITY_TYPE;
          exports2.unstable_SuspenseList = REACT_SUSPENSE_LIST_TYPE;
          exports2.unstable_ViewTransition = REACT_VIEW_TRANSITION_TYPE;
          exports2.unstable_addTransitionType = addTransitionType;
          exports2.unstable_getCacheForType = function (resourceType) {
            var dispatcher = ReactSharedInternals.A;
            return dispatcher
              ? dispatcher.getCacheForType(resourceType)
              : resourceType();
          };
          exports2.unstable_postpone = function (reason) {
            reason = Error(reason);
            reason.$$typeof = REACT_POSTPONE_TYPE;
            throw reason;
          };
          exports2.unstable_startGestureTransition = function (
            provider,
            scope,
            options
          ) {
            if (provider == null)
              throw Error(
                'A Timeline is required as the first argument to startGestureTransition.'
              );
            var prevTransition = ReactSharedInternals.T,
              currentTransition = {
                types: null,
              };
            currentTransition.gesture = provider;
            ReactSharedInternals.T = currentTransition;
            try {
              scope();
              var onStartGestureTransitionFinish = ReactSharedInternals.G;
              if (onStartGestureTransitionFinish !== null)
                return onStartGestureTransitionFinish(
                  currentTransition,
                  provider,
                  options
                );
            } catch (error) {
              reportGlobalError(error);
            } finally {
              ReactSharedInternals.T = prevTransition;
            }
            return noop;
          };
          exports2.unstable_useCacheRefresh = function () {
            return ReactSharedInternals.H.useCacheRefresh();
          };
          exports2.use = function (usable) {
            return ReactSharedInternals.H.use(usable);
          };
          exports2.useActionState = function (action, initialState, permalink) {
            return ReactSharedInternals.H.useActionState(
              action,
              initialState,
              permalink
            );
          };
          exports2.useCallback = function (callback, deps) {
            return ReactSharedInternals.H.useCallback(callback, deps);
          };
          exports2.useContext = function (Context) {
            return ReactSharedInternals.H.useContext(Context);
          };
          exports2.useDebugValue = function () {};
          exports2.useDeferredValue = function (value, initialValue) {
            return ReactSharedInternals.H.useDeferredValue(value, initialValue);
          };
          exports2.useEffect = function (create, deps) {
            return ReactSharedInternals.H.useEffect(create, deps);
          };
          exports2.useId = function () {
            return ReactSharedInternals.H.useId();
          };
          exports2.useImperativeHandle = function (ref, create, deps) {
            return ReactSharedInternals.H.useImperativeHandle(
              ref,
              create,
              deps
            );
          };
          exports2.useInsertionEffect = function (create, deps) {
            return ReactSharedInternals.H.useInsertionEffect(create, deps);
          };
          exports2.useLayoutEffect = function (create, deps) {
            return ReactSharedInternals.H.useLayoutEffect(create, deps);
          };
          exports2.useMemo = function (create, deps) {
            return ReactSharedInternals.H.useMemo(create, deps);
          };
          exports2.useOptimistic = useOptimistic;
          exports2.useReducer = function (reducer, initialArg, init) {
            return ReactSharedInternals.H.useReducer(reducer, initialArg, init);
          };
          exports2.useRef = function (initialValue) {
            return ReactSharedInternals.H.useRef(initialValue);
          };
          exports2.useState = function (initialState) {
            return ReactSharedInternals.H.useState(initialState);
          };
          exports2.useSyncExternalStore = function (
            subscribe,
            getSnapshot,
            getServerSnapshot
          ) {
            return ReactSharedInternals.H.useSyncExternalStore(
              subscribe,
              getSnapshot,
              getServerSnapshot
            );
          };
          exports2.useTransition = function () {
            return ReactSharedInternals.H.useTransition();
          };
          exports2.version = '19.2.0-experimental-5d87cd22-20250704';
        },
        189: (module2, __unused_webpack_exports, __webpack_require__2) => {
          if (true) {
            module2.exports = __webpack_require__2(126);
          } else {
          }
        },
        206: function (module2, exports2, __webpack_require__2) {
          var __WEBPACK_AMD_DEFINE_FACTORY__,
            __WEBPACK_AMD_DEFINE_ARRAY__,
            __WEBPACK_AMD_DEFINE_RESULT__;
          function _typeof(obj) {
            '@babel/helpers - typeof';
            if (
              typeof Symbol === 'function' &&
              typeof Symbol.iterator === 'symbol'
            ) {
              _typeof = function _typeof(obj2) {
                return typeof obj2;
              };
            } else {
              _typeof = function _typeof(obj2) {
                return obj2 &&
                  typeof Symbol === 'function' &&
                  obj2.constructor === Symbol &&
                  obj2 !== Symbol.prototype
                  ? 'symbol'
                  : typeof obj2;
              };
            }
            return _typeof(obj);
          }
          (function (root, factory) {
            if (true) {
              (__WEBPACK_AMD_DEFINE_ARRAY__ = [__webpack_require__2(430)]),
                (__WEBPACK_AMD_DEFINE_FACTORY__ = factory),
                (__WEBPACK_AMD_DEFINE_RESULT__ =
                  typeof __WEBPACK_AMD_DEFINE_FACTORY__ === 'function'
                    ? __WEBPACK_AMD_DEFINE_FACTORY__.apply(
                        exports2,
                        __WEBPACK_AMD_DEFINE_ARRAY__
                      )
                    : __WEBPACK_AMD_DEFINE_FACTORY__),
                __WEBPACK_AMD_DEFINE_RESULT__ !== undefined &&
                  (module2.exports = __WEBPACK_AMD_DEFINE_RESULT__);
            } else {
            }
          })(this, function ErrorStackParser(StackFrame) {
            var FIREFOX_SAFARI_STACK_REGEXP = /(^|@)\S+:\d+/;
            var CHROME_IE_STACK_REGEXP = /^\s*at .*(\S+:\d+|\(native\))/m;
            var SAFARI_NATIVE_CODE_REGEXP = /^(eval@)?(\[native code])?$/;
            return {
              parse: function ErrorStackParser$$parse(error) {
                if (
                  typeof error.stacktrace !== 'undefined' ||
                  typeof error['opera#sourceloc'] !== 'undefined'
                ) {
                  return this.parseOpera(error);
                } else if (
                  error.stack &&
                  error.stack.match(CHROME_IE_STACK_REGEXP)
                ) {
                  return this.parseV8OrIE(error);
                } else if (error.stack) {
                  return this.parseFFOrSafari(error);
                } else {
                  throw new Error('Cannot parse given Error object');
                }
              },
              extractLocation: function ErrorStackParser$$extractLocation(
                urlLike
              ) {
                if (urlLike.indexOf(':') === -1) {
                  return [urlLike];
                }
                var regExp = /(.+?)(?::(\d+))?(?::(\d+))?$/;
                var parts = regExp.exec(urlLike.replace(/[()]/g, ''));
                return [parts[1], parts[2] || undefined, parts[3] || undefined];
              },
              parseV8OrIE: function ErrorStackParser$$parseV8OrIE(error) {
                var filtered = error.stack
                  .split(`
`)
                  .filter(function (line) {
                    return !!line.match(CHROME_IE_STACK_REGEXP);
                  }, this);
                return filtered.map(function (line) {
                  if (line.indexOf('(eval ') > -1) {
                    line = line
                      .replace(/eval code/g, 'eval')
                      .replace(/(\(eval at [^()]*)|(\),.*$)/g, '');
                  }
                  var sanitizedLine = line
                    .replace(/^\s+/, '')
                    .replace(/\(eval code/g, '(');
                  var location = sanitizedLine.match(
                    / (\((.+):(\d+):(\d+)\)$)/
                  );
                  sanitizedLine = location
                    ? sanitizedLine.replace(location[0], '')
                    : sanitizedLine;
                  var tokens = sanitizedLine.split(/\s+/).slice(1);
                  var locationParts = this.extractLocation(
                    location ? location[1] : tokens.pop()
                  );
                  var functionName = tokens.join(' ') || undefined;
                  var fileName =
                    ['eval', '<anonymous>'].indexOf(locationParts[0]) > -1
                      ? undefined
                      : locationParts[0];
                  return new StackFrame({
                    functionName,
                    fileName,
                    lineNumber: locationParts[1],
                    columnNumber: locationParts[2],
                    source: line,
                  });
                }, this);
              },
              parseFFOrSafari: function ErrorStackParser$$parseFFOrSafari(
                error
              ) {
                var filtered = error.stack
                  .split(`
`)
                  .filter(function (line) {
                    return !line.match(SAFARI_NATIVE_CODE_REGEXP);
                  }, this);
                return filtered.map(function (line) {
                  if (line.indexOf(' > eval') > -1) {
                    line = line.replace(
                      / line (\d+)(?: > eval line \d+)* > eval:\d+:\d+/g,
                      ':$1'
                    );
                  }
                  if (line.indexOf('@') === -1 && line.indexOf(':') === -1) {
                    return new StackFrame({
                      functionName: line,
                    });
                  } else {
                    var functionNameRegex = /((.*".+"[^@]*)?[^@]*)(?:@)/;
                    var matches = line.match(functionNameRegex);
                    var functionName =
                      matches && matches[1] ? matches[1] : undefined;
                    var locationParts = this.extractLocation(
                      line.replace(functionNameRegex, '')
                    );
                    return new StackFrame({
                      functionName,
                      fileName: locationParts[0],
                      lineNumber: locationParts[1],
                      columnNumber: locationParts[2],
                      source: line,
                    });
                  }
                }, this);
              },
              parseOpera: function ErrorStackParser$$parseOpera(e) {
                if (
                  !e.stacktrace ||
                  (e.message.indexOf(`
`) > -1 &&
                    e.message.split(`
`).length >
                      e.stacktrace.split(`
`).length)
                ) {
                  return this.parseOpera9(e);
                } else if (!e.stack) {
                  return this.parseOpera10(e);
                } else {
                  return this.parseOpera11(e);
                }
              },
              parseOpera9: function ErrorStackParser$$parseOpera9(e) {
                var lineRE = /Line (\d+).*script (?:in )?(\S+)/i;
                var lines = e.message.split(`
`);
                var result = [];
                for (var i = 2, len = lines.length; i < len; i += 2) {
                  var match = lineRE.exec(lines[i]);
                  if (match) {
                    result.push(
                      new StackFrame({
                        fileName: match[2],
                        lineNumber: match[1],
                        source: lines[i],
                      })
                    );
                  }
                }
                return result;
              },
              parseOpera10: function ErrorStackParser$$parseOpera10(e) {
                var lineRE =
                  /Line (\d+).*script (?:in )?(\S+)(?:: In function (\S+))?$/i;
                var lines = e.stacktrace.split(`
`);
                var result = [];
                for (var i = 0, len = lines.length; i < len; i += 2) {
                  var match = lineRE.exec(lines[i]);
                  if (match) {
                    result.push(
                      new StackFrame({
                        functionName: match[3] || undefined,
                        fileName: match[2],
                        lineNumber: match[1],
                        source: lines[i],
                      })
                    );
                  }
                }
                return result;
              },
              parseOpera11: function ErrorStackParser$$parseOpera11(error) {
                var filtered = error.stack
                  .split(`
`)
                  .filter(function (line) {
                    return (
                      !!line.match(FIREFOX_SAFARI_STACK_REGEXP) &&
                      !line.match(/^Error created at/)
                    );
                  }, this);
                return filtered.map(function (line) {
                  var tokens = line.split('@');
                  var locationParts = this.extractLocation(tokens.pop());
                  var functionCall = tokens.shift() || '';
                  var functionName =
                    functionCall
                      .replace(/<anonymous function(: (\w+))?>/, '$2')
                      .replace(/\([^)]*\)/g, '') || undefined;
                  var argsRaw;
                  if (functionCall.match(/\(([^)]*)\)/)) {
                    argsRaw = functionCall.replace(/^[^(]+\(([^)]*)\)$/, '$1');
                  }
                  var args =
                    argsRaw === undefined ||
                    argsRaw === '[arguments not available]'
                      ? undefined
                      : argsRaw.split(',');
                  return new StackFrame({
                    functionName,
                    args,
                    fileName: locationParts[0],
                    lineNumber: locationParts[1],
                    columnNumber: locationParts[2],
                    source: line,
                  });
                }, this);
              },
            };
          });
        },
        730: (module2, __unused_webpack_exports, __webpack_require__2) => {
          function _classCallCheck(instance, Constructor) {
            if (!(instance instanceof Constructor)) {
              throw new TypeError('Cannot call a class as a function');
            }
          }
          function _defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
              var descriptor = props[i];
              descriptor.enumerable = descriptor.enumerable || false;
              descriptor.configurable = true;
              if ('value' in descriptor) descriptor.writable = true;
              Object.defineProperty(target, descriptor.key, descriptor);
            }
          }
          function _createClass(Constructor, protoProps, staticProps) {
            if (protoProps)
              _defineProperties(Constructor.prototype, protoProps);
            if (staticProps) _defineProperties(Constructor, staticProps);
            return Constructor;
          }
          var Yallist = __webpack_require__2(695);
          var MAX = Symbol('max');
          var LENGTH = Symbol('length');
          var LENGTH_CALCULATOR = Symbol('lengthCalculator');
          var ALLOW_STALE = Symbol('allowStale');
          var MAX_AGE = Symbol('maxAge');
          var DISPOSE = Symbol('dispose');
          var NO_DISPOSE_ON_SET = Symbol('noDisposeOnSet');
          var LRU_LIST = Symbol('lruList');
          var CACHE = Symbol('cache');
          var UPDATE_AGE_ON_GET = Symbol('updateAgeOnGet');
          var naiveLength = function naiveLength() {
            return 1;
          };
          var LRUCache = /* @__PURE__ */ (function () {
            function LRUCache2(options) {
              _classCallCheck(this, LRUCache2);
              if (typeof options === 'number')
                options = {
                  max: options,
                };
              if (!options) options = {};
              if (
                options.max &&
                (typeof options.max !== 'number' || options.max < 0)
              )
                throw new TypeError('max must be a non-negative number');
              var max = (this[MAX] = options.max || Infinity);
              var lc = options.length || naiveLength;
              this[LENGTH_CALCULATOR] =
                typeof lc !== 'function' ? naiveLength : lc;
              this[ALLOW_STALE] = options.stale || false;
              if (options.maxAge && typeof options.maxAge !== 'number')
                throw new TypeError('maxAge must be a number');
              this[MAX_AGE] = options.maxAge || 0;
              this[DISPOSE] = options.dispose;
              this[NO_DISPOSE_ON_SET] = options.noDisposeOnSet || false;
              this[UPDATE_AGE_ON_GET] = options.updateAgeOnGet || false;
              this.reset();
            }
            return _createClass(LRUCache2, [
              {
                key: 'max',
                get: function get() {
                  return this[MAX];
                },
                set: function set(mL) {
                  if (typeof mL !== 'number' || mL < 0)
                    throw new TypeError('max must be a non-negative number');
                  this[MAX] = mL || Infinity;
                  trim(this);
                },
              },
              {
                key: 'allowStale',
                get: function get() {
                  return this[ALLOW_STALE];
                },
                set: function set(allowStale) {
                  this[ALLOW_STALE] = !!allowStale;
                },
              },
              {
                key: 'maxAge',
                get: function get() {
                  return this[MAX_AGE];
                },
                set: function set(mA) {
                  if (typeof mA !== 'number')
                    throw new TypeError('maxAge must be a non-negative number');
                  this[MAX_AGE] = mA;
                  trim(this);
                },
              },
              {
                key: 'lengthCalculator',
                get: function get() {
                  return this[LENGTH_CALCULATOR];
                },
                set: function set(lC) {
                  var _this = this;
                  if (typeof lC !== 'function') lC = naiveLength;
                  if (lC !== this[LENGTH_CALCULATOR]) {
                    this[LENGTH_CALCULATOR] = lC;
                    this[LENGTH] = 0;
                    this[LRU_LIST].forEach(function (hit) {
                      hit.length = _this[LENGTH_CALCULATOR](hit.value, hit.key);
                      _this[LENGTH] += hit.length;
                    });
                  }
                  trim(this);
                },
              },
              {
                key: 'length',
                get: function get() {
                  return this[LENGTH];
                },
              },
              {
                key: 'itemCount',
                get: function get() {
                  return this[LRU_LIST].length;
                },
              },
              {
                key: 'rforEach',
                value: function rforEach(fn, thisp) {
                  thisp = thisp || this;
                  for (var walker = this[LRU_LIST].tail; walker !== null; ) {
                    var prev = walker.prev;
                    forEachStep(this, fn, walker, thisp);
                    walker = prev;
                  }
                },
              },
              {
                key: 'forEach',
                value: function forEach(fn, thisp) {
                  thisp = thisp || this;
                  for (var walker = this[LRU_LIST].head; walker !== null; ) {
                    var next = walker.next;
                    forEachStep(this, fn, walker, thisp);
                    walker = next;
                  }
                },
              },
              {
                key: 'keys',
                value: function keys() {
                  return this[LRU_LIST].toArray().map(function (k) {
                    return k.key;
                  });
                },
              },
              {
                key: 'values',
                value: function values() {
                  return this[LRU_LIST].toArray().map(function (k) {
                    return k.value;
                  });
                },
              },
              {
                key: 'reset',
                value: function reset() {
                  var _this2 = this;
                  if (
                    this[DISPOSE] &&
                    this[LRU_LIST] &&
                    this[LRU_LIST].length
                  ) {
                    this[LRU_LIST].forEach(function (hit) {
                      return _this2[DISPOSE](hit.key, hit.value);
                    });
                  }
                  this[CACHE] = new Map();
                  this[LRU_LIST] = new Yallist();
                  this[LENGTH] = 0;
                },
              },
              {
                key: 'dump',
                value: function dump() {
                  var _this3 = this;
                  return this[LRU_LIST]
                    .map(function (hit) {
                      return isStale(_this3, hit)
                        ? false
                        : {
                            k: hit.key,
                            v: hit.value,
                            e: hit.now + (hit.maxAge || 0),
                          };
                    })
                    .toArray()
                    .filter(function (h) {
                      return h;
                    });
                },
              },
              {
                key: 'dumpLru',
                value: function dumpLru() {
                  return this[LRU_LIST];
                },
              },
              {
                key: 'set',
                value: function set(key, value, maxAge) {
                  maxAge = maxAge || this[MAX_AGE];
                  if (maxAge && typeof maxAge !== 'number')
                    throw new TypeError('maxAge must be a number');
                  var now = maxAge ? Date.now() : 0;
                  var len = this[LENGTH_CALCULATOR](value, key);
                  if (this[CACHE].has(key)) {
                    if (len > this[MAX]) {
                      _del(this, this[CACHE].get(key));
                      return false;
                    }
                    var node = this[CACHE].get(key);
                    var item = node.value;
                    if (this[DISPOSE]) {
                      if (!this[NO_DISPOSE_ON_SET])
                        this[DISPOSE](key, item.value);
                    }
                    item.now = now;
                    item.maxAge = maxAge;
                    item.value = value;
                    this[LENGTH] += len - item.length;
                    item.length = len;
                    this.get(key);
                    trim(this);
                    return true;
                  }
                  var hit = new Entry(key, value, len, now, maxAge);
                  if (hit.length > this[MAX]) {
                    if (this[DISPOSE]) this[DISPOSE](key, value);
                    return false;
                  }
                  this[LENGTH] += hit.length;
                  this[LRU_LIST].unshift(hit);
                  this[CACHE].set(key, this[LRU_LIST].head);
                  trim(this);
                  return true;
                },
              },
              {
                key: 'has',
                value: function has(key) {
                  if (!this[CACHE].has(key)) return false;
                  var hit = this[CACHE].get(key).value;
                  return !isStale(this, hit);
                },
              },
              {
                key: 'get',
                value: function get(key) {
                  return _get(this, key, true);
                },
              },
              {
                key: 'peek',
                value: function peek(key) {
                  return _get(this, key, false);
                },
              },
              {
                key: 'pop',
                value: function pop() {
                  var node = this[LRU_LIST].tail;
                  if (!node) return null;
                  _del(this, node);
                  return node.value;
                },
              },
              {
                key: 'del',
                value: function del(key) {
                  _del(this, this[CACHE].get(key));
                },
              },
              {
                key: 'load',
                value: function load(arr) {
                  this.reset();
                  var now = Date.now();
                  for (var l = arr.length - 1; l >= 0; l--) {
                    var hit = arr[l];
                    var expiresAt = hit.e || 0;
                    if (expiresAt === 0) this.set(hit.k, hit.v);
                    else {
                      var maxAge = expiresAt - now;
                      if (maxAge > 0) {
                        this.set(hit.k, hit.v, maxAge);
                      }
                    }
                  }
                },
              },
              {
                key: 'prune',
                value: function prune() {
                  var _this4 = this;
                  this[CACHE].forEach(function (value, key) {
                    return _get(_this4, key, false);
                  });
                },
              },
            ]);
          })();
          var _get = function _get(self2, key, doUse) {
            var node = self2[CACHE].get(key);
            if (node) {
              var hit = node.value;
              if (isStale(self2, hit)) {
                _del(self2, node);
                if (!self2[ALLOW_STALE]) return;
              } else {
                if (doUse) {
                  if (self2[UPDATE_AGE_ON_GET]) node.value.now = Date.now();
                  self2[LRU_LIST].unshiftNode(node);
                }
              }
              return hit.value;
            }
          };
          var isStale = function isStale(self2, hit) {
            if (!hit || (!hit.maxAge && !self2[MAX_AGE])) return false;
            var diff = Date.now() - hit.now;
            return hit.maxAge
              ? diff > hit.maxAge
              : self2[MAX_AGE] && diff > self2[MAX_AGE];
          };
          var trim = function trim(self2) {
            if (self2[LENGTH] > self2[MAX]) {
              for (
                var walker = self2[LRU_LIST].tail;
                self2[LENGTH] > self2[MAX] && walker !== null;
              ) {
                var prev = walker.prev;
                _del(self2, walker);
                walker = prev;
              }
            }
          };
          var _del = function _del(self2, node) {
            if (node) {
              var hit = node.value;
              if (self2[DISPOSE]) self2[DISPOSE](hit.key, hit.value);
              self2[LENGTH] -= hit.length;
              self2[CACHE].delete(hit.key);
              self2[LRU_LIST].removeNode(node);
            }
          };
          var Entry = /* @__PURE__ */ _createClass(
            function Entry(key, value, length, now, maxAge) {
              _classCallCheck(this, Entry);
              this.key = key;
              this.value = value;
              this.length = length;
              this.now = now;
              this.maxAge = maxAge || 0;
            }
          );
          var forEachStep = function forEachStep(self2, fn, node, thisp) {
            var hit = node.value;
            if (isStale(self2, hit)) {
              _del(self2, node);
              if (!self2[ALLOW_STALE]) hit = undefined;
            }
            if (hit) fn.call(thisp, hit.value, hit.key, self2);
          };
          module2.exports = LRUCache;
        },
        169: (module2) => {
          var process2 = (module2.exports = {});
          var cachedSetTimeout;
          var cachedClearTimeout;
          function defaultSetTimout() {
            throw new Error('setTimeout has not been defined');
          }
          function defaultClearTimeout() {
            throw new Error('clearTimeout has not been defined');
          }
          (function () {
            try {
              if (typeof setTimeout === 'function') {
                cachedSetTimeout = setTimeout;
              } else {
                cachedSetTimeout = defaultSetTimout;
              }
            } catch (e) {
              cachedSetTimeout = defaultSetTimout;
            }
            try {
              if (typeof clearTimeout === 'function') {
                cachedClearTimeout = clearTimeout;
              } else {
                cachedClearTimeout = defaultClearTimeout;
              }
            } catch (e) {
              cachedClearTimeout = defaultClearTimeout;
            }
          })();
          function runTimeout(fun) {
            if (cachedSetTimeout === setTimeout) {
              return setTimeout(fun, 0);
            }
            if (
              (cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) &&
              setTimeout
            ) {
              cachedSetTimeout = setTimeout;
              return setTimeout(fun, 0);
            }
            try {
              return cachedSetTimeout(fun, 0);
            } catch (e) {
              try {
                return cachedSetTimeout.call(null, fun, 0);
              } catch (e2) {
                return cachedSetTimeout.call(this, fun, 0);
              }
            }
          }
          function runClearTimeout(marker) {
            if (cachedClearTimeout === clearTimeout) {
              return clearTimeout(marker);
            }
            if (
              (cachedClearTimeout === defaultClearTimeout ||
                !cachedClearTimeout) &&
              clearTimeout
            ) {
              cachedClearTimeout = clearTimeout;
              return clearTimeout(marker);
            }
            try {
              return cachedClearTimeout(marker);
            } catch (e) {
              try {
                return cachedClearTimeout.call(null, marker);
              } catch (e2) {
                return cachedClearTimeout.call(this, marker);
              }
            }
          }
          var queue = [];
          var draining = false;
          var currentQueue;
          var queueIndex = -1;
          function cleanUpNextTick() {
            if (!draining || !currentQueue) {
              return;
            }
            draining = false;
            if (currentQueue.length) {
              queue = currentQueue.concat(queue);
            } else {
              queueIndex = -1;
            }
            if (queue.length) {
              drainQueue();
            }
          }
          function drainQueue() {
            if (draining) {
              return;
            }
            var timeout = runTimeout(cleanUpNextTick);
            draining = true;
            var len = queue.length;
            while (len) {
              currentQueue = queue;
              queue = [];
              while (++queueIndex < len) {
                if (currentQueue) {
                  currentQueue[queueIndex].run();
                }
              }
              queueIndex = -1;
              len = queue.length;
            }
            currentQueue = null;
            draining = false;
            runClearTimeout(timeout);
          }
          process2.nextTick = function (fun) {
            var args = new Array(arguments.length - 1);
            if (arguments.length > 1) {
              for (var i = 1; i < arguments.length; i++) {
                args[i - 1] = arguments[i];
              }
            }
            queue.push(new Item(fun, args));
            if (queue.length === 1 && !draining) {
              runTimeout(drainQueue);
            }
          };
          function Item(fun, array) {
            this.fun = fun;
            this.array = array;
          }
          Item.prototype.run = function () {
            this.fun.apply(null, this.array);
          };
          process2.title = 'browser';
          process2.browser = true;
          process2.env = {};
          process2.argv = [];
          process2.version = '';
          process2.versions = {};
          function noop() {}
          process2.on = noop;
          process2.addListener = noop;
          process2.once = noop;
          process2.off = noop;
          process2.removeListener = noop;
          process2.removeAllListeners = noop;
          process2.emit = noop;
          process2.prependListener = noop;
          process2.prependOnceListener = noop;
          process2.listeners = function (name) {
            return [];
          };
          process2.binding = function (name) {
            throw new Error('process.binding is not supported');
          };
          process2.cwd = function () {
            return '/';
          };
          process2.chdir = function (dir) {
            throw new Error('process.chdir is not supported');
          };
          process2.umask = function () {
            return 0;
          };
        },
        430: function (module2, exports2) {
          var __WEBPACK_AMD_DEFINE_FACTORY__,
            __WEBPACK_AMD_DEFINE_ARRAY__,
            __WEBPACK_AMD_DEFINE_RESULT__;
          function _typeof(obj) {
            '@babel/helpers - typeof';
            if (
              typeof Symbol === 'function' &&
              typeof Symbol.iterator === 'symbol'
            ) {
              _typeof = function _typeof(obj2) {
                return typeof obj2;
              };
            } else {
              _typeof = function _typeof(obj2) {
                return obj2 &&
                  typeof Symbol === 'function' &&
                  obj2.constructor === Symbol &&
                  obj2 !== Symbol.prototype
                  ? 'symbol'
                  : typeof obj2;
              };
            }
            return _typeof(obj);
          }
          (function (root, factory) {
            if (true) {
              (__WEBPACK_AMD_DEFINE_ARRAY__ = []),
                (__WEBPACK_AMD_DEFINE_FACTORY__ = factory),
                (__WEBPACK_AMD_DEFINE_RESULT__ =
                  typeof __WEBPACK_AMD_DEFINE_FACTORY__ === 'function'
                    ? __WEBPACK_AMD_DEFINE_FACTORY__.apply(
                        exports2,
                        __WEBPACK_AMD_DEFINE_ARRAY__
                      )
                    : __WEBPACK_AMD_DEFINE_FACTORY__),
                __WEBPACK_AMD_DEFINE_RESULT__ !== undefined &&
                  (module2.exports = __WEBPACK_AMD_DEFINE_RESULT__);
            } else {
            }
          })(this, function () {
            function _isNumber(n) {
              return !isNaN(parseFloat(n)) && isFinite(n);
            }
            function _capitalize(str) {
              return str.charAt(0).toUpperCase() + str.substring(1);
            }
            function _getter(p) {
              return function () {
                return this[p];
              };
            }
            var booleanProps = [
              'isConstructor',
              'isEval',
              'isNative',
              'isToplevel',
            ];
            var numericProps = ['columnNumber', 'lineNumber'];
            var stringProps = ['fileName', 'functionName', 'source'];
            var arrayProps = ['args'];
            var props = booleanProps.concat(
              numericProps,
              stringProps,
              arrayProps
            );
            function StackFrame(obj) {
              if (!obj) return;
              for (var i2 = 0; i2 < props.length; i2++) {
                if (obj[props[i2]] !== undefined) {
                  this['set' + _capitalize(props[i2])](obj[props[i2]]);
                }
              }
            }
            StackFrame.prototype = {
              getArgs: function getArgs() {
                return this.args;
              },
              setArgs: function setArgs(v) {
                if (Object.prototype.toString.call(v) !== '[object Array]') {
                  throw new TypeError('Args must be an Array');
                }
                this.args = v;
              },
              getEvalOrigin: function getEvalOrigin() {
                return this.evalOrigin;
              },
              setEvalOrigin: function setEvalOrigin(v) {
                if (v instanceof StackFrame) {
                  this.evalOrigin = v;
                } else if (v instanceof Object) {
                  this.evalOrigin = new StackFrame(v);
                } else {
                  throw new TypeError(
                    'Eval Origin must be an Object or StackFrame'
                  );
                }
              },
              toString: function toString() {
                var fileName = this.getFileName() || '';
                var lineNumber = this.getLineNumber() || '';
                var columnNumber = this.getColumnNumber() || '';
                var functionName = this.getFunctionName() || '';
                if (this.getIsEval()) {
                  if (fileName) {
                    return (
                      '[eval] (' +
                      fileName +
                      ':' +
                      lineNumber +
                      ':' +
                      columnNumber +
                      ')'
                    );
                  }
                  return '[eval]:' + lineNumber + ':' + columnNumber;
                }
                if (functionName) {
                  return (
                    functionName +
                    ' (' +
                    fileName +
                    ':' +
                    lineNumber +
                    ':' +
                    columnNumber +
                    ')'
                  );
                }
                return fileName + ':' + lineNumber + ':' + columnNumber;
              },
            };
            StackFrame.fromString = function StackFrame$$fromString(str) {
              var argsStartIndex = str.indexOf('(');
              var argsEndIndex = str.lastIndexOf(')');
              var functionName = str.substring(0, argsStartIndex);
              var args = str
                .substring(argsStartIndex + 1, argsEndIndex)
                .split(',');
              var locationString = str.substring(argsEndIndex + 1);
              if (locationString.indexOf('@') === 0) {
                var parts = /@(.+?)(?::(\d+))?(?::(\d+))?$/.exec(
                  locationString,
                  ''
                );
                var fileName = parts[1];
                var lineNumber = parts[2];
                var columnNumber = parts[3];
              }
              return new StackFrame({
                functionName,
                args: args || undefined,
                fileName,
                lineNumber: lineNumber || undefined,
                columnNumber: columnNumber || undefined,
              });
            };
            for (var i = 0; i < booleanProps.length; i++) {
              StackFrame.prototype['get' + _capitalize(booleanProps[i])] =
                _getter(booleanProps[i]);
              StackFrame.prototype['set' + _capitalize(booleanProps[i])] =
                (function (p) {
                  return function (v) {
                    this[p] = Boolean(v);
                  };
                })(booleanProps[i]);
            }
            for (var j = 0; j < numericProps.length; j++) {
              StackFrame.prototype['get' + _capitalize(numericProps[j])] =
                _getter(numericProps[j]);
              StackFrame.prototype['set' + _capitalize(numericProps[j])] =
                (function (p) {
                  return function (v) {
                    if (!_isNumber(v)) {
                      throw new TypeError(p + ' must be a Number');
                    }
                    this[p] = Number(v);
                  };
                })(numericProps[j]);
            }
            for (var k = 0; k < stringProps.length; k++) {
              StackFrame.prototype['get' + _capitalize(stringProps[k])] =
                _getter(stringProps[k]);
              StackFrame.prototype['set' + _capitalize(stringProps[k])] =
                (function (p) {
                  return function (v) {
                    this[p] = String(v);
                  };
                })(stringProps[k]);
            }
            return StackFrame;
          });
        },
        476: (module2) => {
          module2.exports = function (Yallist) {
            Yallist.prototype[Symbol.iterator] =
              /* @__PURE__ */ regeneratorRuntime.mark(function _callee() {
                var walker;
                return regeneratorRuntime.wrap(
                  function _callee$(_context) {
                    while (true) {
                      switch ((_context.prev = _context.next)) {
                        case 0:
                          walker = this.head;
                        case 1:
                          if (!walker) {
                            _context.next = 7;
                            break;
                          }
                          _context.next = 4;
                          return walker.value;
                        case 4:
                          walker = walker.next;
                          _context.next = 1;
                          break;
                        case 7:
                        case 'end':
                          return _context.stop();
                      }
                    }
                  },
                  _callee,
                  this
                );
              });
          };
        },
        695: (module2, __unused_webpack_exports, __webpack_require__2) => {
          module2.exports = Yallist;
          Yallist.Node = Node2;
          Yallist.create = Yallist;
          function Yallist(list) {
            var self2 = this;
            if (!(self2 instanceof Yallist)) {
              self2 = new Yallist();
            }
            self2.tail = null;
            self2.head = null;
            self2.length = 0;
            if (list && typeof list.forEach === 'function') {
              list.forEach(function (item) {
                self2.push(item);
              });
            } else if (arguments.length > 0) {
              for (var i = 0, l = arguments.length; i < l; i++) {
                self2.push(arguments[i]);
              }
            }
            return self2;
          }
          Yallist.prototype.removeNode = function (node) {
            if (node.list !== this) {
              throw new Error(
                'removing node which does not belong to this list'
              );
            }
            var next = node.next;
            var prev = node.prev;
            if (next) {
              next.prev = prev;
            }
            if (prev) {
              prev.next = next;
            }
            if (node === this.head) {
              this.head = next;
            }
            if (node === this.tail) {
              this.tail = prev;
            }
            node.list.length--;
            node.next = null;
            node.prev = null;
            node.list = null;
            return next;
          };
          Yallist.prototype.unshiftNode = function (node) {
            if (node === this.head) {
              return;
            }
            if (node.list) {
              node.list.removeNode(node);
            }
            var head = this.head;
            node.list = this;
            node.next = head;
            if (head) {
              head.prev = node;
            }
            this.head = node;
            if (!this.tail) {
              this.tail = node;
            }
            this.length++;
          };
          Yallist.prototype.pushNode = function (node) {
            if (node === this.tail) {
              return;
            }
            if (node.list) {
              node.list.removeNode(node);
            }
            var tail = this.tail;
            node.list = this;
            node.prev = tail;
            if (tail) {
              tail.next = node;
            }
            this.tail = node;
            if (!this.head) {
              this.head = node;
            }
            this.length++;
          };
          Yallist.prototype.push = function () {
            for (var i = 0, l = arguments.length; i < l; i++) {
              push(this, arguments[i]);
            }
            return this.length;
          };
          Yallist.prototype.unshift = function () {
            for (var i = 0, l = arguments.length; i < l; i++) {
              unshift(this, arguments[i]);
            }
            return this.length;
          };
          Yallist.prototype.pop = function () {
            if (!this.tail) {
              return;
            }
            var res = this.tail.value;
            this.tail = this.tail.prev;
            if (this.tail) {
              this.tail.next = null;
            } else {
              this.head = null;
            }
            this.length--;
            return res;
          };
          Yallist.prototype.shift = function () {
            if (!this.head) {
              return;
            }
            var res = this.head.value;
            this.head = this.head.next;
            if (this.head) {
              this.head.prev = null;
            } else {
              this.tail = null;
            }
            this.length--;
            return res;
          };
          Yallist.prototype.forEach = function (fn, thisp) {
            thisp = thisp || this;
            for (var walker = this.head, i = 0; walker !== null; i++) {
              fn.call(thisp, walker.value, i, this);
              walker = walker.next;
            }
          };
          Yallist.prototype.forEachReverse = function (fn, thisp) {
            thisp = thisp || this;
            for (
              var walker = this.tail, i = this.length - 1;
              walker !== null;
              i--
            ) {
              fn.call(thisp, walker.value, i, this);
              walker = walker.prev;
            }
          };
          Yallist.prototype.get = function (n) {
            for (var i = 0, walker = this.head; walker !== null && i < n; i++) {
              walker = walker.next;
            }
            if (i === n && walker !== null) {
              return walker.value;
            }
          };
          Yallist.prototype.getReverse = function (n) {
            for (var i = 0, walker = this.tail; walker !== null && i < n; i++) {
              walker = walker.prev;
            }
            if (i === n && walker !== null) {
              return walker.value;
            }
          };
          Yallist.prototype.map = function (fn, thisp) {
            thisp = thisp || this;
            var res = new Yallist();
            for (var walker = this.head; walker !== null; ) {
              res.push(fn.call(thisp, walker.value, this));
              walker = walker.next;
            }
            return res;
          };
          Yallist.prototype.mapReverse = function (fn, thisp) {
            thisp = thisp || this;
            var res = new Yallist();
            for (var walker = this.tail; walker !== null; ) {
              res.push(fn.call(thisp, walker.value, this));
              walker = walker.prev;
            }
            return res;
          };
          Yallist.prototype.reduce = function (fn, initial) {
            var acc;
            var walker = this.head;
            if (arguments.length > 1) {
              acc = initial;
            } else if (this.head) {
              walker = this.head.next;
              acc = this.head.value;
            } else {
              throw new TypeError('Reduce of empty list with no initial value');
            }
            for (var i = 0; walker !== null; i++) {
              acc = fn(acc, walker.value, i);
              walker = walker.next;
            }
            return acc;
          };
          Yallist.prototype.reduceReverse = function (fn, initial) {
            var acc;
            var walker = this.tail;
            if (arguments.length > 1) {
              acc = initial;
            } else if (this.tail) {
              walker = this.tail.prev;
              acc = this.tail.value;
            } else {
              throw new TypeError('Reduce of empty list with no initial value');
            }
            for (var i = this.length - 1; walker !== null; i--) {
              acc = fn(acc, walker.value, i);
              walker = walker.prev;
            }
            return acc;
          };
          Yallist.prototype.toArray = function () {
            var arr = new Array(this.length);
            for (var i = 0, walker = this.head; walker !== null; i++) {
              arr[i] = walker.value;
              walker = walker.next;
            }
            return arr;
          };
          Yallist.prototype.toArrayReverse = function () {
            var arr = new Array(this.length);
            for (var i = 0, walker = this.tail; walker !== null; i++) {
              arr[i] = walker.value;
              walker = walker.prev;
            }
            return arr;
          };
          Yallist.prototype.slice = function (from, to) {
            to = to || this.length;
            if (to < 0) {
              to += this.length;
            }
            from = from || 0;
            if (from < 0) {
              from += this.length;
            }
            var ret = new Yallist();
            if (to < from || to < 0) {
              return ret;
            }
            if (from < 0) {
              from = 0;
            }
            if (to > this.length) {
              to = this.length;
            }
            for (
              var i = 0, walker = this.head;
              walker !== null && i < from;
              i++
            ) {
              walker = walker.next;
            }
            for (; walker !== null && i < to; i++, walker = walker.next) {
              ret.push(walker.value);
            }
            return ret;
          };
          Yallist.prototype.sliceReverse = function (from, to) {
            to = to || this.length;
            if (to < 0) {
              to += this.length;
            }
            from = from || 0;
            if (from < 0) {
              from += this.length;
            }
            var ret = new Yallist();
            if (to < from || to < 0) {
              return ret;
            }
            if (from < 0) {
              from = 0;
            }
            if (to > this.length) {
              to = this.length;
            }
            for (
              var i = this.length, walker = this.tail;
              walker !== null && i > to;
              i--
            ) {
              walker = walker.prev;
            }
            for (; walker !== null && i > from; i--, walker = walker.prev) {
              ret.push(walker.value);
            }
            return ret;
          };
          Yallist.prototype.splice = function (start, deleteCount) {
            if (start > this.length) {
              start = this.length - 1;
            }
            if (start < 0) {
              start = this.length + start;
            }
            for (
              var i = 0, walker = this.head;
              walker !== null && i < start;
              i++
            ) {
              walker = walker.next;
            }
            var ret = [];
            for (var i = 0; walker && i < deleteCount; i++) {
              ret.push(walker.value);
              walker = this.removeNode(walker);
            }
            if (walker === null) {
              walker = this.tail;
            }
            if (walker !== this.head && walker !== this.tail) {
              walker = walker.prev;
            }
            for (var i = 2; i < arguments.length; i++) {
              walker = insert(this, walker, arguments[i]);
            }
            return ret;
          };
          Yallist.prototype.reverse = function () {
            var head = this.head;
            var tail = this.tail;
            for (var walker = head; walker !== null; walker = walker.prev) {
              var p = walker.prev;
              walker.prev = walker.next;
              walker.next = p;
            }
            this.head = tail;
            this.tail = head;
            return this;
          };
          function insert(self2, node, value) {
            var inserted =
              node === self2.head
                ? new Node2(value, null, node, self2)
                : new Node2(value, node, node.next, self2);
            if (inserted.next === null) {
              self2.tail = inserted;
            }
            if (inserted.prev === null) {
              self2.head = inserted;
            }
            self2.length++;
            return inserted;
          }
          function push(self2, item) {
            self2.tail = new Node2(item, self2.tail, null, self2);
            if (!self2.head) {
              self2.head = self2.tail;
            }
            self2.length++;
          }
          function unshift(self2, item) {
            self2.head = new Node2(item, null, self2.head, self2);
            if (!self2.tail) {
              self2.tail = self2.head;
            }
            self2.length++;
          }
          function Node2(value, prev, next, list) {
            if (!(this instanceof Node2)) {
              return new Node2(value, prev, next, list);
            }
            this.list = list;
            this.value = value;
            if (prev) {
              prev.next = this;
              this.prev = prev;
            } else {
              this.prev = null;
            }
            if (next) {
              next.prev = this;
              this.next = next;
            } else {
              this.next = null;
            }
          }
          try {
            __webpack_require__2(476)(Yallist);
          } catch (er) {}
        },
      };
      var __webpack_module_cache__ = {};
      function __webpack_require__(moduleId) {
        var cachedModule = __webpack_module_cache__[moduleId];
        if (cachedModule !== undefined) {
          return cachedModule.exports;
        }
        var module2 = (__webpack_module_cache__[moduleId] = {
          exports: {},
        });
        __webpack_modules__[moduleId].call(
          module2.exports,
          module2,
          module2.exports,
          __webpack_require__
        );
        return module2.exports;
      }
      (() => {
        __webpack_require__.n = (module2) => {
          var getter =
            module2 && module2.__esModule
              ? () => module2['default']
              : () => module2;
          __webpack_require__.d(getter, { a: getter });
          return getter;
        };
      })();
      (() => {
        __webpack_require__.d = (exports2, definition) => {
          for (var key in definition) {
            if (
              __webpack_require__.o(definition, key) &&
              !__webpack_require__.o(exports2, key)
            ) {
              Object.defineProperty(exports2, key, {
                enumerable: true,
                get: definition[key],
              });
            }
          }
        };
      })();
      (() => {
        __webpack_require__.o = (obj, prop) =>
          Object.prototype.hasOwnProperty.call(obj, prop);
      })();
      (() => {
        __webpack_require__.r = (exports2) => {
          if (typeof Symbol !== 'undefined' && Symbol.toStringTag) {
            Object.defineProperty(exports2, Symbol.toStringTag, {
              value: 'Module',
            });
          }
          Object.defineProperty(exports2, '__esModule', { value: true });
        };
      })();
      var __webpack_exports__ = {};
      (() => {
        __webpack_require__.r(__webpack_exports__);
        __webpack_require__.d(__webpack_exports__, {
          connectToDevTools: () => connectToDevTools,
          connectWithCustomMessagingProtocol: () =>
            connectWithCustomMessagingProtocol,
          initialize: () => backend_initialize,
        });
        function _classCallCheck(instance, Constructor) {
          if (!(instance instanceof Constructor)) {
            throw new TypeError('Cannot call a class as a function');
          }
        }
        function _defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor) descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
          }
        }
        function _createClass(Constructor, protoProps, staticProps) {
          if (protoProps) _defineProperties(Constructor.prototype, protoProps);
          if (staticProps) _defineProperties(Constructor, staticProps);
          return Constructor;
        }
        function _defineProperty(obj, key, value) {
          if (key in obj) {
            Object.defineProperty(obj, key, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          } else {
            obj[key] = value;
          }
          return obj;
        }
        var EventEmitter = /* @__PURE__ */ (function () {
          function EventEmitter2() {
            _classCallCheck(this, EventEmitter2);
            _defineProperty(this, 'listenersMap', new Map());
          }
          return _createClass(EventEmitter2, [
            {
              key: 'addListener',
              value: function addListener(event, listener) {
                var listeners = this.listenersMap.get(event);
                if (listeners === undefined) {
                  this.listenersMap.set(event, [listener]);
                } else {
                  var index = listeners.indexOf(listener);
                  if (index < 0) {
                    listeners.push(listener);
                  }
                }
              },
            },
            {
              key: 'emit',
              value: function emit(event) {
                var listeners = this.listenersMap.get(event);
                if (listeners !== undefined) {
                  for (
                    var _len = arguments.length,
                      args = new Array(_len > 1 ? _len - 1 : 0),
                      _key = 1;
                    _key < _len;
                    _key++
                  ) {
                    args[_key - 1] = arguments[_key];
                  }
                  if (listeners.length === 1) {
                    var listener = listeners[0];
                    listener.apply(null, args);
                  } else {
                    var didThrow = false;
                    var caughtError = null;
                    var clonedListeners = Array.from(listeners);
                    for (var i = 0; i < clonedListeners.length; i++) {
                      var _listener = clonedListeners[i];
                      try {
                        _listener.apply(null, args);
                      } catch (error) {
                        if (caughtError === null) {
                          didThrow = true;
                          caughtError = error;
                        }
                      }
                    }
                    if (didThrow) {
                      throw caughtError;
                    }
                  }
                }
              },
            },
            {
              key: 'removeAllListeners',
              value: function removeAllListeners() {
                this.listenersMap.clear();
              },
            },
            {
              key: 'removeListener',
              value: function removeListener(event, listener) {
                var listeners = this.listenersMap.get(event);
                if (listeners !== undefined) {
                  var index = listeners.indexOf(listener);
                  if (index >= 0) {
                    listeners.splice(index, 1);
                  }
                }
              },
            },
          ]);
        })();
        var CHROME_WEBSTORE_EXTENSION_ID = 'fmkadmapgofadopljbjfkapdkoienihi';
        var INTERNAL_EXTENSION_ID = 'dnjnjgbfilfphmojnmhliehogmojhclc';
        var LOCAL_EXTENSION_ID = 'ikiahnapldjmdmpkmfhjdjilojjhgcbf';
        var __DEBUG__ = false;
        var __PERFORMANCE_PROFILE__ = false;
        var TREE_OPERATION_ADD = 1;
        var TREE_OPERATION_REMOVE = 2;
        var TREE_OPERATION_REORDER_CHILDREN = 3;
        var TREE_OPERATION_UPDATE_TREE_BASE_DURATION = 4;
        var TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS = 5;
        var TREE_OPERATION_REMOVE_ROOT = 6;
        var TREE_OPERATION_SET_SUBTREE_MODE = 7;
        var PROFILING_FLAG_BASIC_SUPPORT = 1;
        var PROFILING_FLAG_TIMELINE_SUPPORT = 2;
        var LOCAL_STORAGE_DEFAULT_TAB_KEY = 'React::DevTools::defaultTab';
        var constants_LOCAL_STORAGE_COMPONENT_FILTER_PREFERENCES_KEY =
          'React::DevTools::componentFilters';
        var SESSION_STORAGE_LAST_SELECTION_KEY =
          'React::DevTools::lastSelection';
        var constants_LOCAL_STORAGE_OPEN_IN_EDITOR_URL =
          'React::DevTools::openInEditorUrl';
        var LOCAL_STORAGE_OPEN_IN_EDITOR_URL_PRESET =
          'React::DevTools::openInEditorUrlPreset';
        var LOCAL_STORAGE_PARSE_HOOK_NAMES_KEY =
          'React::DevTools::parseHookNames';
        var constants_SESSION_STORAGE_RECORD_CHANGE_DESCRIPTIONS_KEY =
          'React::DevTools::recordChangeDescriptions';
        var constants_SESSION_STORAGE_RECORD_TIMELINE_KEY =
          'React::DevTools::recordTimeline';
        var constants_SESSION_STORAGE_RELOAD_AND_PROFILE_KEY =
          'React::DevTools::reloadAndProfile';
        var LOCAL_STORAGE_BROWSER_THEME = 'React::DevTools::theme';
        var LOCAL_STORAGE_TRACE_UPDATES_ENABLED_KEY =
          'React::DevTools::traceUpdatesEnabled';
        var LOCAL_STORAGE_SUPPORTS_PROFILING_KEY =
          'React::DevTools::supportsProfiling';
        var PROFILER_EXPORT_VERSION = 5;
        var FIREFOX_CONSOLE_DIMMING_COLOR = 'color: rgba(124, 124, 124, 0.75)';
        var ANSI_STYLE_DIMMING_TEMPLATE = '\x1B[2;38;2;124;124;124m%s\x1B[0m';
        var ANSI_STYLE_DIMMING_TEMPLATE_WITH_COMPONENT_STACK =
          '\x1B[2;38;2;124;124;124m%s %o\x1B[0m';
        function _typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            _typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            _typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return _typeof(obj);
        }
        function _slicedToArray(arr, i) {
          return (
            _arrayWithHoles(arr) ||
            _iterableToArrayLimit(arr, i) ||
            _unsupportedIterableToArray(arr, i) ||
            _nonIterableRest()
          );
        }
        function _nonIterableRest() {
          throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function _unsupportedIterableToArray(o, minLen) {
          if (!o) return;
          if (typeof o === 'string') return _arrayLikeToArray(o, minLen);
          var n = Object.prototype.toString.call(o).slice(8, -1);
          if (n === 'Object' && o.constructor) n = o.constructor.name;
          if (n === 'Map' || n === 'Set') return Array.from(o);
          if (
            n === 'Arguments' ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return _arrayLikeToArray(o, minLen);
        }
        function _arrayLikeToArray(arr, len) {
          if (len == null || len > arr.length) len = arr.length;
          for (var i = 0, arr2 = new Array(len); i < len; i++) {
            arr2[i] = arr[i];
          }
          return arr2;
        }
        function _iterableToArrayLimit(arr, i) {
          if (
            typeof Symbol === 'undefined' ||
            !(Symbol.iterator in Object(arr))
          )
            return;
          var _arr = [];
          var _n = true;
          var _d = false;
          var _e = undefined;
          try {
            for (
              var _i = arr[Symbol.iterator](), _s;
              !(_n = (_s = _i.next()).done);
              _n = true
            ) {
              _arr.push(_s.value);
              if (i && _arr.length === i) break;
            }
          } catch (err) {
            _d = true;
            _e = err;
          } finally {
            try {
              if (!_n && _i['return'] != null) _i['return']();
            } finally {
              if (_d) throw _e;
            }
          }
          return _arr;
        }
        function _arrayWithHoles(arr) {
          if (Array.isArray(arr)) return arr;
        }
        var compareVersions = function compareVersions(v1, v2) {
          var n1 = validateAndParse(v1);
          var n2 = validateAndParse(v2);
          var p1 = n1.pop();
          var p2 = n2.pop();
          var r = compareSegments(n1, n2);
          if (r !== 0) return r;
          if (p1 && p2) {
            return compareSegments(p1.split('.'), p2.split('.'));
          } else if (p1 || p2) {
            return p1 ? -1 : 1;
          }
          return 0;
        };
        var validate = function validate(version) {
          return (
            typeof version === 'string' &&
            /^[v\d]/.test(version) &&
            semver.test(version)
          );
        };
        var compare = function compare(v1, v2, operator) {
          assertValidOperator(operator);
          var res = compareVersions(v1, v2);
          return operatorResMap[operator].includes(res);
        };
        var satisfies = function satisfies(version, range) {
          var m = range.match(/^([<>=~^]+)/);
          var op = m ? m[1] : '=';
          if (op !== '^' && op !== '~') return compare(version, range, op);
          var _validateAndParse = validateAndParse(version),
            _validateAndParse2 = _slicedToArray(_validateAndParse, 5),
            v1 = _validateAndParse2[0],
            v2 = _validateAndParse2[1],
            v3 = _validateAndParse2[2],
            vp = _validateAndParse2[4];
          var _validateAndParse3 = validateAndParse(range),
            _validateAndParse4 = _slicedToArray(_validateAndParse3, 5),
            r1 = _validateAndParse4[0],
            r2 = _validateAndParse4[1],
            r3 = _validateAndParse4[2],
            rp = _validateAndParse4[4];
          var v = [v1, v2, v3];
          var r = [
            r1,
            r2 !== null && r2 !== undefined ? r2 : 'x',
            r3 !== null && r3 !== undefined ? r3 : 'x',
          ];
          if (rp) {
            if (!vp) return false;
            if (compareSegments(v, r) !== 0) return false;
            if (compareSegments(vp.split('.'), rp.split('.')) === -1)
              return false;
          }
          var nonZero =
            r.findIndex(function (v4) {
              return v4 !== '0';
            }) + 1;
          var i = op === '~' ? 2 : nonZero > 1 ? nonZero : 1;
          if (compareSegments(v.slice(0, i), r.slice(0, i)) !== 0) return false;
          if (compareSegments(v.slice(i), r.slice(i)) === -1) return false;
          return true;
        };
        var semver =
          /^[v^~<>=]*?(\d+)(?:\.([x*]|\d+)(?:\.([x*]|\d+)(?:\.([x*]|\d+))?(?:-([\da-z\-]+(?:\.[\da-z\-]+)*))?(?:\+[\da-z\-]+(?:\.[\da-z\-]+)*)?)?)?$/i;
        var validateAndParse = function validateAndParse(version) {
          if (typeof version !== 'string') {
            throw new TypeError('Invalid argument expected string');
          }
          var match = version.match(semver);
          if (!match) {
            throw new Error(
              "Invalid argument not valid semver ('".concat(
                version,
                "' received)"
              )
            );
          }
          match.shift();
          return match;
        };
        var isWildcard = function isWildcard(s) {
          return s === '*' || s === 'x' || s === 'X';
        };
        var tryParse = function tryParse(v) {
          var n = parseInt(v, 10);
          return isNaN(n) ? v : n;
        };
        var forceType = function forceType(a, b) {
          return _typeof(a) !== _typeof(b) ? [String(a), String(b)] : [a, b];
        };
        var compareStrings = function compareStrings(a, b) {
          if (isWildcard(a) || isWildcard(b)) return 0;
          var _forceType = forceType(tryParse(a), tryParse(b)),
            _forceType2 = _slicedToArray(_forceType, 2),
            ap = _forceType2[0],
            bp = _forceType2[1];
          if (ap > bp) return 1;
          if (ap < bp) return -1;
          return 0;
        };
        var compareSegments = function compareSegments(a, b) {
          for (var i = 0; i < Math.max(a.length, b.length); i++) {
            var r = compareStrings(a[i] || '0', b[i] || '0');
            if (r !== 0) return r;
          }
          return 0;
        };
        var operatorResMap = {
          '>': [1],
          '>=': [0, 1],
          '=': [0],
          '<=': [-1, 0],
          '<': [-1],
        };
        var allowedOperators = Object.keys(operatorResMap);
        var assertValidOperator = function assertValidOperator(op) {
          if (typeof op !== 'string') {
            throw new TypeError(
              'Invalid operator type, expected string but got '.concat(
                _typeof(op)
              )
            );
          }
          if (allowedOperators.indexOf(op) === -1) {
            throw new Error(
              'Invalid operator, expected one of '.concat(
                allowedOperators.join('|')
              )
            );
          }
        };
        var lru_cache = __webpack_require__(730);
        var lru_cache_default = /* @__PURE__ */ __webpack_require__.n(
          lru_cache
        );
        var enableHydrationLaneScheduling = true;
        var favorSafetyOverHydrationPerf = true;
        var disableSchedulerTimeoutInWorkLoop = false;
        var enableSuspenseCallback = false;
        var enableScopeAPI = false;
        var enableCreateEventHandleAPI = false;
        var enableLegacyFBSupport = false;
        var enableYieldingBeforePassive = false;
        var enableThrottledScheduling = false;
        var enableLegacyCache = null;
        var enableAsyncIterableChildren = null;
        var enableTaint = null;
        var enablePostpone = null;
        var enableHalt = null;
        var enableViewTransition = null;
        var enableGestureTransition = null;
        var enableScrollEndPolyfill = null;
        var enableSuspenseyImages = false;
        var enableFizzBlockingRender = null;
        var enableSrcObject = null;
        var enableHydrationChangeEvent = null;
        var enableDefaultTransitionIndicator = null;
        var enableObjectFiber = false;
        var enableTransitionTracing = false;
        var enableLegacyHidden = false;
        var enableSuspenseAvoidThisFallback = false;
        var enableCPUSuspense = null;
        var enableNoCloningMemoCache = false;
        var enableUseEffectEventHook = null;
        var enableFizzExternalRuntime = null;
        var alwaysThrottleRetries = true;
        var passChildrenWhenCloningPersistedNodes = false;
        var enablePersistedModeClonedFlag = false;
        var enableEagerAlternateStateNodeCleanup = true;
        var enableRetryLaneExpiration = false;
        var retryLaneExpirationMs = 5000;
        var syncLaneExpirationMs = 250;
        var transitionLaneExpirationMs = 5000;
        var enableInfiniteRenderLoopDetection = false;
        var enableLazyPublicInstanceInFabric = false;
        var enableFragmentRefs = null;
        var renameElementSymbol = true;
        var enableHiddenSubtreeInsertionEffectCleanup = false;
        var disableLegacyContext = true;
        var disableLegacyContextForFunctionComponents = true;
        var enableMoveBefore = false;
        var disableClientCache = true;
        var enableReactTestRendererWarning = true;
        var disableLegacyMode = true;
        var disableCommentsAsDOMContainers = true;
        var enableTrustedTypesIntegration = false;
        var disableInputAttributeSyncing = false;
        var disableTextareaChildren = false;
        var enableProfilerTimer = null;
        var enableComponentPerformanceTrack = true;
        var enableSchedulingProfiler =
          !enableComponentPerformanceTrack && false;
        var enableProfilerCommitHooks = null;
        var enableProfilerNestedUpdatePhase = null;
        var enableAsyncDebugInfo = null;
        var enableUpdaterTracking = null;
        var ownerStackLimit = 1e4;
        function ReactSymbols_typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            ReactSymbols_typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            ReactSymbols_typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return ReactSymbols_typeof(obj);
        }
        var REACT_LEGACY_ELEMENT_TYPE = Symbol.for('react.element');
        var REACT_ELEMENT_TYPE = renameElementSymbol
          ? Symbol.for('react.transitional.element')
          : REACT_LEGACY_ELEMENT_TYPE;
        var REACT_PORTAL_TYPE = Symbol.for('react.portal');
        var REACT_FRAGMENT_TYPE = Symbol.for('react.fragment');
        var REACT_STRICT_MODE_TYPE = Symbol.for('react.strict_mode');
        var REACT_PROFILER_TYPE = Symbol.for('react.profiler');
        var REACT_CONSUMER_TYPE = Symbol.for('react.consumer');
        var REACT_CONTEXT_TYPE = Symbol.for('react.context');
        var REACT_FORWARD_REF_TYPE = Symbol.for('react.forward_ref');
        var REACT_SUSPENSE_TYPE = Symbol.for('react.suspense');
        var REACT_SUSPENSE_LIST_TYPE = Symbol.for('react.suspense_list');
        var REACT_MEMO_TYPE = Symbol.for('react.memo');
        var REACT_LAZY_TYPE = Symbol.for('react.lazy');
        var REACT_SCOPE_TYPE = Symbol.for('react.scope');
        var REACT_ACTIVITY_TYPE = Symbol.for('react.activity');
        var REACT_LEGACY_HIDDEN_TYPE = Symbol.for('react.legacy_hidden');
        var REACT_TRACING_MARKER_TYPE = Symbol.for('react.tracing_marker');
        var REACT_MEMO_CACHE_SENTINEL = Symbol.for('react.memo_cache_sentinel');
        var REACT_POSTPONE_TYPE = Symbol.for('react.postpone');
        var REACT_VIEW_TRANSITION_TYPE = Symbol.for('react.view_transition');
        var MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
        var FAUX_ITERATOR_SYMBOL = '@@iterator';
        function getIteratorFn(maybeIterable) {
          if (
            maybeIterable === null ||
            ReactSymbols_typeof(maybeIterable) !== 'object'
          ) {
            return null;
          }
          var maybeIterator =
            (MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL]) ||
            maybeIterable[FAUX_ITERATOR_SYMBOL];
          if (typeof maybeIterator === 'function') {
            return maybeIterator;
          }
          return null;
        }
        var ASYNC_ITERATOR = Symbol.asyncIterator;
        var types_ElementTypeClass = 1;
        var ElementTypeContext = 2;
        var types_ElementTypeFunction = 5;
        var types_ElementTypeForwardRef = 6;
        var ElementTypeHostComponent = 7;
        var types_ElementTypeMemo = 8;
        var ElementTypeOtherOrUnknown = 9;
        var ElementTypeProfiler = 10;
        var ElementTypeRoot = 11;
        var ElementTypeSuspense = 12;
        var ElementTypeSuspenseList = 13;
        var ElementTypeTracingMarker = 14;
        var types_ElementTypeVirtual = 15;
        var ElementTypeViewTransition = 16;
        var ElementTypeActivity = 17;
        var ComponentFilterElementType = 1;
        var ComponentFilterDisplayName = 2;
        var ComponentFilterLocation = 3;
        var ComponentFilterHOC = 4;
        var ComponentFilterEnvironmentName = 5;
        var StrictMode = 1;
        var isArray = Array.isArray;
        const src_isArray = isArray;
        var process2 = __webpack_require__(169);
        function ownKeys(object, enumerableOnly) {
          var keys = Object.keys(object);
          if (Object.getOwnPropertySymbols) {
            var symbols = Object.getOwnPropertySymbols(object);
            if (enumerableOnly)
              symbols = symbols.filter(function (sym) {
                return Object.getOwnPropertyDescriptor(object, sym).enumerable;
              });
            keys.push.apply(keys, symbols);
          }
          return keys;
        }
        function _objectSpread(target) {
          for (var i = 1; i < arguments.length; i++) {
            var source = arguments[i] != null ? arguments[i] : {};
            if (i % 2) {
              ownKeys(Object(source), true).forEach(function (key) {
                utils_defineProperty(target, key, source[key]);
              });
            } else if (Object.getOwnPropertyDescriptors) {
              Object.defineProperties(
                target,
                Object.getOwnPropertyDescriptors(source)
              );
            } else {
              ownKeys(Object(source)).forEach(function (key) {
                Object.defineProperty(
                  target,
                  key,
                  Object.getOwnPropertyDescriptor(source, key)
                );
              });
            }
          }
          return target;
        }
        function utils_defineProperty(obj, key, value) {
          if (key in obj) {
            Object.defineProperty(obj, key, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          } else {
            obj[key] = value;
          }
          return obj;
        }
        function utils_typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            utils_typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            utils_typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return utils_typeof(obj);
        }
        function _toConsumableArray(arr) {
          return (
            _arrayWithoutHoles(arr) ||
            _iterableToArray(arr) ||
            utils_unsupportedIterableToArray(arr) ||
            _nonIterableSpread()
          );
        }
        function _nonIterableSpread() {
          throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function utils_unsupportedIterableToArray(o, minLen) {
          if (!o) return;
          if (typeof o === 'string') return utils_arrayLikeToArray(o, minLen);
          var n = Object.prototype.toString.call(o).slice(8, -1);
          if (n === 'Object' && o.constructor) n = o.constructor.name;
          if (n === 'Map' || n === 'Set') return Array.from(o);
          if (
            n === 'Arguments' ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return utils_arrayLikeToArray(o, minLen);
        }
        function _iterableToArray(iter) {
          if (typeof Symbol !== 'undefined' && Symbol.iterator in Object(iter))
            return Array.from(iter);
        }
        function _arrayWithoutHoles(arr) {
          if (Array.isArray(arr)) return utils_arrayLikeToArray(arr);
        }
        function utils_arrayLikeToArray(arr, len) {
          if (len == null || len > arr.length) len = arr.length;
          for (var i = 0, arr2 = new Array(len); i < len; i++) {
            arr2[i] = arr[i];
          }
          return arr2;
        }
        var utils_hasOwnProperty = Object.prototype.hasOwnProperty;
        var cachedDisplayNames = new WeakMap();
        var encodedStringCache = new (lru_cache_default())({
          max: 1000,
        });
        var LEGACY_REACT_PROVIDER_TYPE = Symbol.for('react.provider');
        function alphaSortKeys(a, b) {
          if (a.toString() > b.toString()) {
            return 1;
          } else if (b.toString() > a.toString()) {
            return -1;
          } else {
            return 0;
          }
        }
        function getAllEnumerableKeys(obj) {
          var keys = new Set();
          var current = obj;
          var _loop = function _loop() {
            var currentKeys = [].concat(
              _toConsumableArray(Object.keys(current)),
              _toConsumableArray(Object.getOwnPropertySymbols(current))
            );
            var descriptors = Object.getOwnPropertyDescriptors(current);
            currentKeys.forEach(function (key) {
              if (descriptors[key].enumerable) {
                keys.add(key);
              }
            });
            current = Object.getPrototypeOf(current);
          };
          while (current != null) {
            _loop();
          }
          return keys;
        }
        function getWrappedDisplayName(
          outerType,
          innerType,
          wrapperName,
          fallbackName
        ) {
          var displayName =
            outerType === null || outerType === undefined
              ? undefined
              : outerType.displayName;
          return (
            displayName ||
            ''
              .concat(wrapperName, '(')
              .concat(getDisplayName(innerType, fallbackName), ')')
          );
        }
        function getDisplayName(type) {
          var fallbackName =
            arguments.length > 1 && arguments[1] !== undefined
              ? arguments[1]
              : 'Anonymous';
          var nameFromCache = cachedDisplayNames.get(type);
          if (nameFromCache != null) {
            return nameFromCache;
          }
          var displayName = fallbackName;
          if (typeof type.displayName === 'string') {
            displayName = type.displayName;
          } else if (typeof type.name === 'string' && type.name !== '') {
            displayName = type.name;
          }
          cachedDisplayNames.set(type, displayName);
          return displayName;
        }
        var uidCounter = 0;
        function getUID() {
          return ++uidCounter;
        }
        function utfDecodeStringWithRanges(array, left, right) {
          var string = '';
          for (var i = left; i <= right; i++) {
            string += String.fromCodePoint(array[i]);
          }
          return string;
        }
        function surrogatePairToCodePoint(charCode1, charCode2) {
          return ((charCode1 & 1023) << 10) + (charCode2 & 1023) + 65536;
        }
        function utfEncodeString(string) {
          var cached = encodedStringCache.get(string);
          if (cached !== undefined) {
            return cached;
          }
          var encoded = [];
          var i = 0;
          var charCode;
          while (i < string.length) {
            charCode = string.charCodeAt(i);
            if ((charCode & 63488) === 55296) {
              encoded.push(
                surrogatePairToCodePoint(charCode, string.charCodeAt(++i))
              );
            } else {
              encoded.push(charCode);
            }
            ++i;
          }
          encodedStringCache.set(string, encoded);
          return encoded;
        }
        function printOperationsArray(operations) {
          var rendererID = operations[0];
          var rootID = operations[1];
          var logs = [
            'operations for renderer:'
              .concat(rendererID, ' and root:')
              .concat(rootID),
          ];
          var i = 2;
          var stringTable = [null];
          var stringTableSize = operations[i++];
          var stringTableEnd = i + stringTableSize;
          while (i < stringTableEnd) {
            var nextLength = operations[i++];
            var nextString = utfDecodeStringWithRanges(
              operations,
              i,
              i + nextLength - 1
            );
            stringTable.push(nextString);
            i += nextLength;
          }
          while (i < operations.length) {
            var operation = operations[i];
            switch (operation) {
              case TREE_OPERATION_ADD: {
                var _id = operations[i + 1];
                var type = operations[i + 2];
                i += 3;
                if (type === ElementTypeRoot) {
                  logs.push('Add new root node '.concat(_id));
                  i++;
                  i++;
                  i++;
                  i++;
                } else {
                  var parentID = operations[i];
                  i++;
                  i++;
                  var displayNameStringID = operations[i];
                  var displayName = stringTable[displayNameStringID];
                  i++;
                  i++;
                  logs.push(
                    'Add node '
                      .concat(_id, ' (')
                      .concat(displayName || 'null', ') as child of ')
                      .concat(parentID)
                  );
                }
                break;
              }
              case TREE_OPERATION_REMOVE: {
                var removeLength = operations[i + 1];
                i += 2;
                for (
                  var removeIndex = 0;
                  removeIndex < removeLength;
                  removeIndex++
                ) {
                  var _id2 = operations[i];
                  i += 1;
                  logs.push('Remove node '.concat(_id2));
                }
                break;
              }
              case TREE_OPERATION_REMOVE_ROOT: {
                i += 1;
                logs.push('Remove root '.concat(rootID));
                break;
              }
              case TREE_OPERATION_SET_SUBTREE_MODE: {
                var _id3 = operations[i + 1];
                var mode = operations[i + 1];
                i += 3;
                logs.push(
                  'Mode '
                    .concat(mode, ' set for subtree with root ')
                    .concat(_id3)
                );
                break;
              }
              case TREE_OPERATION_REORDER_CHILDREN: {
                var _id4 = operations[i + 1];
                var numChildren = operations[i + 2];
                i += 3;
                var children = operations.slice(i, i + numChildren);
                i += numChildren;
                logs.push(
                  'Re-order node '
                    .concat(_id4, ' children ')
                    .concat(children.join(','))
                );
                break;
              }
              case TREE_OPERATION_UPDATE_TREE_BASE_DURATION:
                i += 3;
                break;
              case TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS:
                var id = operations[i + 1];
                var numErrors = operations[i + 2];
                var numWarnings = operations[i + 3];
                i += 4;
                logs.push(
                  'Node '
                    .concat(id, ' has ')
                    .concat(numErrors, ' errors and ')
                    .concat(numWarnings, ' warnings')
                );
                break;
              default:
                throw Error(
                  'Unsupported Bridge operation "'.concat(operation, '"')
                );
            }
          }
          console.log(
            logs.join(`
  `)
          );
        }
        function getDefaultComponentFilters() {
          return [
            {
              type: ComponentFilterElementType,
              value: ElementTypeHostComponent,
              isEnabled: true,
            },
          ];
        }
        function getSavedComponentFilters() {
          try {
            var raw = localStorageGetItem(
              LOCAL_STORAGE_COMPONENT_FILTER_PREFERENCES_KEY
            );
            if (raw != null) {
              var parsedFilters = JSON.parse(raw);
              return filterOutLocationComponentFilters(parsedFilters);
            }
          } catch (error) {}
          return getDefaultComponentFilters();
        }
        function setSavedComponentFilters(componentFilters) {
          localStorageSetItem(
            LOCAL_STORAGE_COMPONENT_FILTER_PREFERENCES_KEY,
            JSON.stringify(filterOutLocationComponentFilters(componentFilters))
          );
        }
        function filterOutLocationComponentFilters(componentFilters) {
          if (!Array.isArray(componentFilters)) {
            return componentFilters;
          }
          return componentFilters.filter(function (f) {
            return f.type !== ComponentFilterLocation;
          });
        }
        function getDefaultOpenInEditorURL() {
          return typeof process2.env.EDITOR_URL === 'string'
            ? process2.env.EDITOR_URL
            : '';
        }
        function getOpenInEditorURL() {
          try {
            var raw = localStorageGetItem(LOCAL_STORAGE_OPEN_IN_EDITOR_URL);
            if (raw != null) {
              return JSON.parse(raw);
            }
          } catch (error) {}
          return getDefaultOpenInEditorURL();
        }
        function parseElementDisplayNameFromBackend(displayName, type) {
          if (displayName === null) {
            return {
              formattedDisplayName: null,
              hocDisplayNames: null,
              compiledWithForget: false,
            };
          }
          if (displayName.startsWith('Forget(')) {
            var displayNameWithoutForgetWrapper = displayName.slice(
              7,
              displayName.length - 1
            );
            var _parseElementDisplayN = parseElementDisplayNameFromBackend(
                displayNameWithoutForgetWrapper,
                type
              ),
              formattedDisplayName = _parseElementDisplayN.formattedDisplayName,
              _hocDisplayNames = _parseElementDisplayN.hocDisplayNames;
            return {
              formattedDisplayName,
              hocDisplayNames: _hocDisplayNames,
              compiledWithForget: true,
            };
          }
          var hocDisplayNames = null;
          switch (type) {
            case ElementTypeClass:
            case ElementTypeForwardRef:
            case ElementTypeFunction:
            case ElementTypeMemo:
            case ElementTypeVirtual:
              if (displayName.indexOf('(') >= 0) {
                var matches = displayName.match(/[^()]+/g);
                if (matches != null) {
                  displayName = matches.pop();
                  hocDisplayNames = matches;
                }
              }
              break;
            default:
              break;
          }
          return {
            formattedDisplayName: displayName,
            hocDisplayNames,
            compiledWithForget: false,
          };
        }
        function shallowDiffers(prev, next) {
          for (var attribute in prev) {
            if (!(attribute in next)) {
              return true;
            }
          }
          for (var _attribute in next) {
            if (prev[_attribute] !== next[_attribute]) {
              return true;
            }
          }
          return false;
        }
        function utils_getInObject(object, path) {
          return path.reduce(function (reduced, attr) {
            if (reduced) {
              if (utils_hasOwnProperty.call(reduced, attr)) {
                return reduced[attr];
              }
              if (typeof reduced[Symbol.iterator] === 'function') {
                return Array.from(reduced)[attr];
              }
            }
            return null;
          }, object);
        }
        function deletePathInObject(object, path) {
          var length = path.length;
          var last = path[length - 1];
          if (object != null) {
            var parent = utils_getInObject(object, path.slice(0, length - 1));
            if (parent) {
              if (src_isArray(parent)) {
                parent.splice(last, 1);
              } else {
                delete parent[last];
              }
            }
          }
        }
        function renamePathInObject(object, oldPath, newPath) {
          var length = oldPath.length;
          if (object != null) {
            var parent = utils_getInObject(
              object,
              oldPath.slice(0, length - 1)
            );
            if (parent) {
              var lastOld = oldPath[length - 1];
              var lastNew = newPath[length - 1];
              parent[lastNew] = parent[lastOld];
              if (src_isArray(parent)) {
                parent.splice(lastOld, 1);
              } else {
                delete parent[lastOld];
              }
            }
          }
        }
        function utils_setInObject(object, path, value) {
          var length = path.length;
          var last = path[length - 1];
          if (object != null) {
            var parent = utils_getInObject(object, path.slice(0, length - 1));
            if (parent) {
              parent[last] = value;
            }
          }
        }
        function isError(data) {
          if ('name' in data && 'message' in data) {
            while (data) {
              if (Object.prototype.toString.call(data) === '[object Error]') {
                return true;
              }
              data = Object.getPrototypeOf(data);
            }
          }
          return false;
        }
        function getDataType(data) {
          if (data === null) {
            return 'null';
          } else if (data === undefined) {
            return 'undefined';
          }
          if (
            typeof HTMLElement !== 'undefined' &&
            data instanceof HTMLElement
          ) {
            return 'html_element';
          }
          var type = utils_typeof(data);
          switch (type) {
            case 'bigint':
              return 'bigint';
            case 'boolean':
              return 'boolean';
            case 'function':
              return 'function';
            case 'number':
              if (Number.isNaN(data)) {
                return 'nan';
              } else if (!Number.isFinite(data)) {
                return 'infinity';
              } else {
                return 'number';
              }
            case 'object':
              if (
                data.$$typeof === REACT_ELEMENT_TYPE ||
                data.$$typeof === REACT_LEGACY_ELEMENT_TYPE
              ) {
                return 'react_element';
              }
              if (src_isArray(data)) {
                return 'array';
              } else if (ArrayBuffer.isView(data)) {
                return utils_hasOwnProperty.call(
                  data.constructor,
                  'BYTES_PER_ELEMENT'
                )
                  ? 'typed_array'
                  : 'data_view';
              } else if (
                data.constructor &&
                data.constructor.name === 'ArrayBuffer'
              ) {
                return 'array_buffer';
              } else if (typeof data[Symbol.iterator] === 'function') {
                var iterator = data[Symbol.iterator]();
                if (!iterator) {
                } else {
                  return iterator === data ? 'opaque_iterator' : 'iterator';
                }
              } else if (
                data.constructor &&
                data.constructor.name === 'RegExp'
              ) {
                return 'regexp';
              } else if (typeof data.then === 'function') {
                return 'thenable';
              } else if (isError(data)) {
                return 'error';
              } else {
                var toStringValue = Object.prototype.toString.call(data);
                if (toStringValue === '[object Date]') {
                  return 'date';
                } else if (toStringValue === '[object HTMLAllCollection]') {
                  return 'html_all_collection';
                }
              }
              if (!isPlainObject(data)) {
                return 'class_instance';
              }
              return 'object';
            case 'string':
              return 'string';
            case 'symbol':
              return 'symbol';
            case 'undefined':
              if (
                Object.prototype.toString.call(data) ===
                '[object HTMLAllCollection]'
              ) {
                return 'html_all_collection';
              }
              return 'undefined';
            default:
              return 'unknown';
          }
        }
        function typeOfWithLegacyElementSymbol(object) {
          if (utils_typeof(object) === 'object' && object !== null) {
            var $$typeof = object.$$typeof;
            switch ($$typeof) {
              case REACT_ELEMENT_TYPE:
              case REACT_LEGACY_ELEMENT_TYPE:
                var type = object.type;
                switch (type) {
                  case REACT_FRAGMENT_TYPE:
                  case REACT_PROFILER_TYPE:
                  case REACT_STRICT_MODE_TYPE:
                  case REACT_SUSPENSE_TYPE:
                  case REACT_SUSPENSE_LIST_TYPE:
                  case REACT_VIEW_TRANSITION_TYPE:
                    return type;
                  default:
                    var $$typeofType = type && type.$$typeof;
                    switch ($$typeofType) {
                      case REACT_CONTEXT_TYPE:
                      case REACT_FORWARD_REF_TYPE:
                      case REACT_LAZY_TYPE:
                      case REACT_MEMO_TYPE:
                        return $$typeofType;
                      case REACT_CONSUMER_TYPE:
                        return $$typeofType;
                      default:
                        return $$typeof;
                    }
                }
              case REACT_PORTAL_TYPE:
                return $$typeof;
            }
          }
          return;
        }
        function getDisplayNameForReactElement(element) {
          var elementType = typeOfWithLegacyElementSymbol(element);
          switch (elementType) {
            case REACT_CONSUMER_TYPE:
              return 'ContextConsumer';
            case LEGACY_REACT_PROVIDER_TYPE:
              return 'ContextProvider';
            case REACT_CONTEXT_TYPE:
              return 'Context';
            case REACT_FORWARD_REF_TYPE:
              return 'ForwardRef';
            case REACT_FRAGMENT_TYPE:
              return 'Fragment';
            case REACT_LAZY_TYPE:
              return 'Lazy';
            case REACT_MEMO_TYPE:
              return 'Memo';
            case REACT_PORTAL_TYPE:
              return 'Portal';
            case REACT_PROFILER_TYPE:
              return 'Profiler';
            case REACT_STRICT_MODE_TYPE:
              return 'StrictMode';
            case REACT_SUSPENSE_TYPE:
              return 'Suspense';
            case REACT_SUSPENSE_LIST_TYPE:
              return 'SuspenseList';
            case REACT_VIEW_TRANSITION_TYPE:
              return 'ViewTransition';
            case REACT_TRACING_MARKER_TYPE:
              return 'TracingMarker';
            default:
              var type = element.type;
              if (typeof type === 'string') {
                return type;
              } else if (typeof type === 'function') {
                return getDisplayName(type, 'Anonymous');
              } else if (type != null) {
                return 'NotImplementedInDevtools';
              } else {
                return 'Element';
              }
          }
        }
        var MAX_PREVIEW_STRING_LENGTH = 50;
        function truncateForDisplay(string) {
          var length =
            arguments.length > 1 && arguments[1] !== undefined
              ? arguments[1]
              : MAX_PREVIEW_STRING_LENGTH;
          if (string.length > length) {
            return string.slice(0, length) + '…';
          } else {
            return string;
          }
        }
        function formatDataForPreview(data, showFormattedValue) {
          if (data != null && utils_hasOwnProperty.call(data, meta.type)) {
            return showFormattedValue
              ? data[meta.preview_long]
              : data[meta.preview_short];
          }
          var type = getDataType(data);
          switch (type) {
            case 'html_element':
              return '<'.concat(
                truncateForDisplay(data.tagName.toLowerCase()),
                ' />'
              );
            case 'function':
              if (typeof data.name === 'function' || data.name === '') {
                return '() => {}';
              }
              return ''.concat(truncateForDisplay(data.name), '() {}');
            case 'string':
              return '"'.concat(data, '"');
            case 'bigint':
              return truncateForDisplay(data.toString() + 'n');
            case 'regexp':
              return truncateForDisplay(data.toString());
            case 'symbol':
              return truncateForDisplay(data.toString());
            case 'react_element':
              return '<'.concat(
                truncateForDisplay(
                  getDisplayNameForReactElement(data) || 'Unknown'
                ),
                ' />'
              );
            case 'array_buffer':
              return 'ArrayBuffer('.concat(data.byteLength, ')');
            case 'data_view':
              return 'DataView('.concat(data.buffer.byteLength, ')');
            case 'array':
              if (showFormattedValue) {
                var formatted = '';
                for (var i = 0; i < data.length; i++) {
                  if (i > 0) {
                    formatted += ', ';
                  }
                  formatted += formatDataForPreview(data[i], false);
                  if (formatted.length > MAX_PREVIEW_STRING_LENGTH) {
                    break;
                  }
                }
                return '['.concat(truncateForDisplay(formatted), ']');
              } else {
                var length = utils_hasOwnProperty.call(data, meta.size)
                  ? data[meta.size]
                  : data.length;
                return 'Array('.concat(length, ')');
              }
            case 'typed_array':
              var shortName = ''
                .concat(data.constructor.name, '(')
                .concat(data.length, ')');
              if (showFormattedValue) {
                var _formatted = '';
                for (var _i = 0; _i < data.length; _i++) {
                  if (_i > 0) {
                    _formatted += ', ';
                  }
                  _formatted += data[_i];
                  if (_formatted.length > MAX_PREVIEW_STRING_LENGTH) {
                    break;
                  }
                }
                return ''
                  .concat(shortName, ' [')
                  .concat(truncateForDisplay(_formatted), ']');
              } else {
                return shortName;
              }
            case 'iterator':
              var name = data.constructor.name;
              if (showFormattedValue) {
                var array = Array.from(data);
                var _formatted2 = '';
                for (var _i2 = 0; _i2 < array.length; _i2++) {
                  var entryOrEntries = array[_i2];
                  if (_i2 > 0) {
                    _formatted2 += ', ';
                  }
                  if (src_isArray(entryOrEntries)) {
                    var key = formatDataForPreview(entryOrEntries[0], true);
                    var value = formatDataForPreview(entryOrEntries[1], false);
                    _formatted2 += ''.concat(key, ' => ').concat(value);
                  } else {
                    _formatted2 += formatDataForPreview(entryOrEntries, false);
                  }
                  if (_formatted2.length > MAX_PREVIEW_STRING_LENGTH) {
                    break;
                  }
                }
                return ''
                  .concat(name, '(')
                  .concat(data.size, ') {')
                  .concat(truncateForDisplay(_formatted2), '}');
              } else {
                return ''.concat(name, '(').concat(data.size, ')');
              }
            case 'opaque_iterator': {
              return data[Symbol.toStringTag];
            }
            case 'date':
              return data.toString();
            case 'class_instance':
              try {
                var resolvedConstructorName = data.constructor.name;
                if (typeof resolvedConstructorName === 'string') {
                  return resolvedConstructorName;
                }
                resolvedConstructorName =
                  Object.getPrototypeOf(data).constructor.name;
                if (typeof resolvedConstructorName === 'string') {
                  return resolvedConstructorName;
                }
                try {
                  return truncateForDisplay(String(data));
                } catch (error) {
                  return 'unserializable';
                }
              } catch (error) {
                return 'unserializable';
              }
            case 'thenable':
              var displayName;
              if (isPlainObject(data)) {
                displayName = 'Thenable';
              } else {
                var _resolvedConstructorName = data.constructor.name;
                if (typeof _resolvedConstructorName !== 'string') {
                  _resolvedConstructorName =
                    Object.getPrototypeOf(data).constructor.name;
                }
                if (typeof _resolvedConstructorName === 'string') {
                  displayName = _resolvedConstructorName;
                } else {
                  displayName = 'Thenable';
                }
              }
              switch (data.status) {
                case 'pending':
                  return 'pending '.concat(displayName);
                case 'fulfilled':
                  if (showFormattedValue) {
                    var _formatted3 = formatDataForPreview(data.value, false);
                    return 'fulfilled '
                      .concat(displayName, ' {')
                      .concat(truncateForDisplay(_formatted3), '}');
                  } else {
                    return 'fulfilled '.concat(displayName, ' {…}');
                  }
                case 'rejected':
                  if (showFormattedValue) {
                    var _formatted4 = formatDataForPreview(data.reason, false);
                    return 'rejected '
                      .concat(displayName, ' {')
                      .concat(truncateForDisplay(_formatted4), '}');
                  } else {
                    return 'rejected '.concat(displayName, ' {…}');
                  }
                default:
                  return displayName;
              }
            case 'object':
              if (showFormattedValue) {
                var keys = Array.from(getAllEnumerableKeys(data)).sort(
                  alphaSortKeys
                );
                var _formatted5 = '';
                for (var _i3 = 0; _i3 < keys.length; _i3++) {
                  var _key = keys[_i3];
                  if (_i3 > 0) {
                    _formatted5 += ', ';
                  }
                  _formatted5 += ''
                    .concat(_key.toString(), ': ')
                    .concat(formatDataForPreview(data[_key], false));
                  if (_formatted5.length > MAX_PREVIEW_STRING_LENGTH) {
                    break;
                  }
                }
                return '{'.concat(truncateForDisplay(_formatted5), '}');
              } else {
                return '{…}';
              }
            case 'error':
              return truncateForDisplay(String(data));
            case 'boolean':
            case 'number':
            case 'infinity':
            case 'nan':
            case 'null':
            case 'undefined':
              return String(data);
            default:
              try {
                return truncateForDisplay(String(data));
              } catch (error) {
                return 'unserializable';
              }
          }
        }
        var isPlainObject = function isPlainObject(object) {
          var objectPrototype = Object.getPrototypeOf(object);
          if (!objectPrototype) return true;
          var objectParentPrototype = Object.getPrototypeOf(objectPrototype);
          return !objectParentPrototype;
        };
        function backendToFrontendSerializedElementMapper(element) {
          var _parseElementDisplayN2 = parseElementDisplayNameFromBackend(
              element.displayName,
              element.type
            ),
            formattedDisplayName = _parseElementDisplayN2.formattedDisplayName,
            hocDisplayNames = _parseElementDisplayN2.hocDisplayNames,
            compiledWithForget = _parseElementDisplayN2.compiledWithForget;
          return _objectSpread(
            _objectSpread({}, element),
            {},
            {
              displayName: formattedDisplayName,
              hocDisplayNames,
              compiledWithForget,
            }
          );
        }
        function normalizeUrlIfValid(url) {
          try {
            return new URL(url).toString();
          } catch (_unused) {
            return url;
          }
        }
        function getIsReloadAndProfileSupported() {
          var isBackendStorageAPISupported = false;
          try {
            localStorage.getItem('test');
            isBackendStorageAPISupported = true;
          } catch (error) {}
          return isBackendStorageAPISupported && isSynchronousXHRSupported();
        }
        function getIfReloadedAndProfiling() {
          return (
            sessionStorageGetItem(SESSION_STORAGE_RELOAD_AND_PROFILE_KEY) ===
            'true'
          );
        }
        function getProfilingSettings() {
          return {
            recordChangeDescriptions:
              sessionStorageGetItem(
                SESSION_STORAGE_RECORD_CHANGE_DESCRIPTIONS_KEY
              ) === 'true',
            recordTimeline:
              sessionStorageGetItem(SESSION_STORAGE_RECORD_TIMELINE_KEY) ===
              'true',
          };
        }
        function onReloadAndProfile(recordChangeDescriptions, recordTimeline) {
          sessionStorageSetItem(SESSION_STORAGE_RELOAD_AND_PROFILE_KEY, 'true');
          sessionStorageSetItem(
            SESSION_STORAGE_RECORD_CHANGE_DESCRIPTIONS_KEY,
            recordChangeDescriptions ? 'true' : 'false'
          );
          sessionStorageSetItem(
            SESSION_STORAGE_RECORD_TIMELINE_KEY,
            recordTimeline ? 'true' : 'false'
          );
        }
        function onReloadAndProfileFlagsReset() {
          sessionStorageRemoveItem(SESSION_STORAGE_RELOAD_AND_PROFILE_KEY);
          sessionStorageRemoveItem(
            SESSION_STORAGE_RECORD_CHANGE_DESCRIPTIONS_KEY
          );
          sessionStorageRemoveItem(SESSION_STORAGE_RECORD_TIMELINE_KEY);
        }
        function hydration_ownKeys(object, enumerableOnly) {
          var keys = Object.keys(object);
          if (Object.getOwnPropertySymbols) {
            var symbols = Object.getOwnPropertySymbols(object);
            if (enumerableOnly)
              symbols = symbols.filter(function (sym) {
                return Object.getOwnPropertyDescriptor(object, sym).enumerable;
              });
            keys.push.apply(keys, symbols);
          }
          return keys;
        }
        function hydration_objectSpread(target) {
          for (var i = 1; i < arguments.length; i++) {
            var source = arguments[i] != null ? arguments[i] : {};
            if (i % 2) {
              hydration_ownKeys(Object(source), true).forEach(function (key) {
                hydration_defineProperty(target, key, source[key]);
              });
            } else if (Object.getOwnPropertyDescriptors) {
              Object.defineProperties(
                target,
                Object.getOwnPropertyDescriptors(source)
              );
            } else {
              hydration_ownKeys(Object(source)).forEach(function (key) {
                Object.defineProperty(
                  target,
                  key,
                  Object.getOwnPropertyDescriptor(source, key)
                );
              });
            }
          }
          return target;
        }
        function hydration_defineProperty(obj, key, value) {
          if (key in obj) {
            Object.defineProperty(obj, key, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          } else {
            obj[key] = value;
          }
          return obj;
        }
        function hydration_typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            hydration_typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            hydration_typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return hydration_typeof(obj);
        }
        var meta = {
          inspectable: Symbol('inspectable'),
          inspected: Symbol('inspected'),
          name: Symbol('name'),
          preview_long: Symbol('preview_long'),
          preview_short: Symbol('preview_short'),
          readonly: Symbol('readonly'),
          size: Symbol('size'),
          type: Symbol('type'),
          unserializable: Symbol('unserializable'),
        };
        var LEVEL_THRESHOLD = 2;
        function createDehydrated(type, inspectable, data, cleaned, path) {
          cleaned.push(path);
          var dehydrated = {
            inspectable,
            type,
            preview_long: formatDataForPreview(data, true),
            preview_short: formatDataForPreview(data, false),
            name:
              typeof data.constructor !== 'function' ||
              typeof data.constructor.name !== 'string' ||
              data.constructor.name === 'Object'
                ? ''
                : data.constructor.name,
          };
          if (type === 'array' || type === 'typed_array') {
            dehydrated.size = data.length;
          } else if (type === 'object') {
            dehydrated.size = Object.keys(data).length;
          }
          if (type === 'iterator' || type === 'typed_array') {
            dehydrated.readonly = true;
          }
          return dehydrated;
        }
        function dehydrate(data, cleaned, unserializable, path, isPathAllowed) {
          var level =
            arguments.length > 5 && arguments[5] !== undefined
              ? arguments[5]
              : 0;
          var type = getDataType(data);
          var isPathAllowedCheck;
          switch (type) {
            case 'html_element':
              cleaned.push(path);
              return {
                inspectable: false,
                preview_short: formatDataForPreview(data, false),
                preview_long: formatDataForPreview(data, true),
                name: data.tagName,
                type,
              };
            case 'function':
              cleaned.push(path);
              return {
                inspectable: false,
                preview_short: formatDataForPreview(data, false),
                preview_long: formatDataForPreview(data, true),
                name:
                  typeof data.name === 'function' || !data.name
                    ? 'function'
                    : data.name,
                type,
              };
            case 'string':
              isPathAllowedCheck = isPathAllowed(path);
              if (isPathAllowedCheck) {
                return data;
              } else {
                return data.length <= 500 ? data : data.slice(0, 500) + '...';
              }
            case 'bigint':
              cleaned.push(path);
              return {
                inspectable: false,
                preview_short: formatDataForPreview(data, false),
                preview_long: formatDataForPreview(data, true),
                name: data.toString(),
                type,
              };
            case 'symbol':
              cleaned.push(path);
              return {
                inspectable: false,
                preview_short: formatDataForPreview(data, false),
                preview_long: formatDataForPreview(data, true),
                name: data.toString(),
                type,
              };
            case 'react_element':
              cleaned.push(path);
              return {
                inspectable: false,
                preview_short: formatDataForPreview(data, false),
                preview_long: formatDataForPreview(data, true),
                name: getDisplayNameForReactElement(data) || 'Unknown',
                type,
              };
            case 'array_buffer':
            case 'data_view':
              cleaned.push(path);
              return {
                inspectable: false,
                preview_short: formatDataForPreview(data, false),
                preview_long: formatDataForPreview(data, true),
                name: type === 'data_view' ? 'DataView' : 'ArrayBuffer',
                size: data.byteLength,
                type,
              };
            case 'array':
              isPathAllowedCheck = isPathAllowed(path);
              if (level >= LEVEL_THRESHOLD && !isPathAllowedCheck) {
                return createDehydrated(type, true, data, cleaned, path);
              }
              var arr = [];
              for (var i = 0; i < data.length; i++) {
                arr[i] = dehydrateKey(
                  data,
                  i,
                  cleaned,
                  unserializable,
                  path.concat([i]),
                  isPathAllowed,
                  isPathAllowedCheck ? 1 : level + 1
                );
              }
              return arr;
            case 'html_all_collection':
            case 'typed_array':
            case 'iterator':
              isPathAllowedCheck = isPathAllowed(path);
              if (level >= LEVEL_THRESHOLD && !isPathAllowedCheck) {
                return createDehydrated(type, true, data, cleaned, path);
              } else {
                var unserializableValue = {
                  unserializable: true,
                  type,
                  readonly: true,
                  size: type === 'typed_array' ? data.length : undefined,
                  preview_short: formatDataForPreview(data, false),
                  preview_long: formatDataForPreview(data, true),
                  name:
                    typeof data.constructor !== 'function' ||
                    typeof data.constructor.name !== 'string' ||
                    data.constructor.name === 'Object'
                      ? ''
                      : data.constructor.name,
                };
                Array.from(data).forEach(function (item, i2) {
                  return (unserializableValue[i2] = dehydrate(
                    item,
                    cleaned,
                    unserializable,
                    path.concat([i2]),
                    isPathAllowed,
                    isPathAllowedCheck ? 1 : level + 1
                  ));
                });
                unserializable.push(path);
                return unserializableValue;
              }
            case 'opaque_iterator':
              cleaned.push(path);
              return {
                inspectable: false,
                preview_short: formatDataForPreview(data, false),
                preview_long: formatDataForPreview(data, true),
                name: data[Symbol.toStringTag],
                type,
              };
            case 'date':
              cleaned.push(path);
              return {
                inspectable: false,
                preview_short: formatDataForPreview(data, false),
                preview_long: formatDataForPreview(data, true),
                name: data.toString(),
                type,
              };
            case 'regexp':
              cleaned.push(path);
              return {
                inspectable: false,
                preview_short: formatDataForPreview(data, false),
                preview_long: formatDataForPreview(data, true),
                name: data.toString(),
                type,
              };
            case 'thenable':
              isPathAllowedCheck = isPathAllowed(path);
              if (level >= LEVEL_THRESHOLD && !isPathAllowedCheck) {
                return {
                  inspectable:
                    data.status === 'fulfilled' || data.status === 'rejected',
                  preview_short: formatDataForPreview(data, false),
                  preview_long: formatDataForPreview(data, true),
                  name: data.toString(),
                  type,
                };
              }
              switch (data.status) {
                case 'fulfilled': {
                  var _unserializableValue = {
                    unserializable: true,
                    type,
                    preview_short: formatDataForPreview(data, false),
                    preview_long: formatDataForPreview(data, true),
                    name: 'fulfilled Thenable',
                  };
                  _unserializableValue.value = dehydrate(
                    data.value,
                    cleaned,
                    unserializable,
                    path.concat(['value']),
                    isPathAllowed,
                    isPathAllowedCheck ? 1 : level + 1
                  );
                  unserializable.push(path);
                  return _unserializableValue;
                }
                case 'rejected': {
                  var _unserializableValue2 = {
                    unserializable: true,
                    type,
                    preview_short: formatDataForPreview(data, false),
                    preview_long: formatDataForPreview(data, true),
                    name: 'rejected Thenable',
                  };
                  _unserializableValue2.reason = dehydrate(
                    data.reason,
                    cleaned,
                    unserializable,
                    path.concat(['reason']),
                    isPathAllowed,
                    isPathAllowedCheck ? 1 : level + 1
                  );
                  unserializable.push(path);
                  return _unserializableValue2;
                }
                default:
                  cleaned.push(path);
                  return {
                    inspectable: false,
                    preview_short: formatDataForPreview(data, false),
                    preview_long: formatDataForPreview(data, true),
                    name: data.toString(),
                    type,
                  };
              }
            case 'object':
              isPathAllowedCheck = isPathAllowed(path);
              if (level >= LEVEL_THRESHOLD && !isPathAllowedCheck) {
                return createDehydrated(type, true, data, cleaned, path);
              } else {
                var object = {};
                getAllEnumerableKeys(data).forEach(function (key) {
                  var name = key.toString();
                  object[name] = dehydrateKey(
                    data,
                    key,
                    cleaned,
                    unserializable,
                    path.concat([name]),
                    isPathAllowed,
                    isPathAllowedCheck ? 1 : level + 1
                  );
                });
                return object;
              }
            case 'class_instance': {
              isPathAllowedCheck = isPathAllowed(path);
              if (level >= LEVEL_THRESHOLD && !isPathAllowedCheck) {
                return createDehydrated(type, true, data, cleaned, path);
              }
              var value = {
                unserializable: true,
                type,
                readonly: true,
                preview_short: formatDataForPreview(data, false),
                preview_long: formatDataForPreview(data, true),
                name:
                  typeof data.constructor !== 'function' ||
                  typeof data.constructor.name !== 'string'
                    ? ''
                    : data.constructor.name,
              };
              getAllEnumerableKeys(data).forEach(function (key) {
                var keyAsString = key.toString();
                value[keyAsString] = dehydrate(
                  data[key],
                  cleaned,
                  unserializable,
                  path.concat([keyAsString]),
                  isPathAllowed,
                  isPathAllowedCheck ? 1 : level + 1
                );
              });
              unserializable.push(path);
              return value;
            }
            case 'error': {
              isPathAllowedCheck = isPathAllowed(path);
              if (level >= LEVEL_THRESHOLD && !isPathAllowedCheck) {
                return createDehydrated(type, true, data, cleaned, path);
              }
              var _value = {
                unserializable: true,
                type,
                readonly: true,
                preview_short: formatDataForPreview(data, false),
                preview_long: formatDataForPreview(data, true),
                name: data.name,
              };
              _value.message = dehydrate(
                data.message,
                cleaned,
                unserializable,
                path.concat(['message']),
                isPathAllowed,
                isPathAllowedCheck ? 1 : level + 1
              );
              _value.stack = dehydrate(
                data.stack,
                cleaned,
                unserializable,
                path.concat(['stack']),
                isPathAllowed,
                isPathAllowedCheck ? 1 : level + 1
              );
              if ('cause' in data) {
                _value.cause = dehydrate(
                  data.cause,
                  cleaned,
                  unserializable,
                  path.concat(['cause']),
                  isPathAllowed,
                  isPathAllowedCheck ? 1 : level + 1
                );
              }
              getAllEnumerableKeys(data).forEach(function (key) {
                var keyAsString = key.toString();
                _value[keyAsString] = dehydrate(
                  data[key],
                  cleaned,
                  unserializable,
                  path.concat([keyAsString]),
                  isPathAllowed,
                  isPathAllowedCheck ? 1 : level + 1
                );
              });
              unserializable.push(path);
              return _value;
            }
            case 'infinity':
            case 'nan':
            case 'undefined':
              cleaned.push(path);
              return {
                type,
              };
            default:
              return data;
          }
        }
        function dehydrateKey(
          parent,
          key,
          cleaned,
          unserializable,
          path,
          isPathAllowed
        ) {
          var level =
            arguments.length > 6 && arguments[6] !== undefined
              ? arguments[6]
              : 0;
          try {
            return dehydrate(
              parent[key],
              cleaned,
              unserializable,
              path,
              isPathAllowed,
              level
            );
          } catch (error) {
            var preview = '';
            if (
              hydration_typeof(error) === 'object' &&
              error !== null &&
              typeof error.stack === 'string'
            ) {
              preview = error.stack;
            } else if (typeof error === 'string') {
              preview = error;
            }
            cleaned.push(path);
            return {
              inspectable: false,
              preview_short: '[Exception]',
              preview_long: preview
                ? '[Exception: ' + preview + ']'
                : '[Exception]',
              name: preview,
              type: 'unknown',
            };
          }
        }
        function fillInPath(object, data, path, value) {
          var target = getInObject(object, path);
          if (target != null) {
            if (!target[meta.unserializable]) {
              delete target[meta.inspectable];
              delete target[meta.inspected];
              delete target[meta.name];
              delete target[meta.preview_long];
              delete target[meta.preview_short];
              delete target[meta.readonly];
              delete target[meta.size];
              delete target[meta.type];
            }
          }
          if (value !== null && data.unserializable.length > 0) {
            var unserializablePath = data.unserializable[0];
            var isMatch = unserializablePath.length === path.length;
            for (var i = 0; i < path.length; i++) {
              if (path[i] !== unserializablePath[i]) {
                isMatch = false;
                break;
              }
            }
            if (isMatch) {
              upgradeUnserializable(value, value);
            }
          }
          setInObject(object, path, value);
        }
        function hydrate(object, cleaned, unserializable) {
          cleaned.forEach(function (path) {
            var length = path.length;
            var last = path[length - 1];
            var parent = getInObject(object, path.slice(0, length - 1));
            if (!parent || !parent.hasOwnProperty(last)) {
              return;
            }
            var value = parent[last];
            if (!value) {
              return;
            } else if (value.type === 'infinity') {
              parent[last] = Infinity;
            } else if (value.type === 'nan') {
              parent[last] = NaN;
            } else if (value.type === 'undefined') {
              parent[last] = undefined;
            } else {
              var replaced = {};
              replaced[meta.inspectable] = !!value.inspectable;
              replaced[meta.inspected] = false;
              replaced[meta.name] = value.name;
              replaced[meta.preview_long] = value.preview_long;
              replaced[meta.preview_short] = value.preview_short;
              replaced[meta.size] = value.size;
              replaced[meta.readonly] = !!value.readonly;
              replaced[meta.type] = value.type;
              parent[last] = replaced;
            }
          });
          unserializable.forEach(function (path) {
            var length = path.length;
            var last = path[length - 1];
            var parent = getInObject(object, path.slice(0, length - 1));
            if (!parent || !parent.hasOwnProperty(last)) {
              return;
            }
            var node = parent[last];
            var replacement = hydration_objectSpread({}, node);
            upgradeUnserializable(replacement, node);
            parent[last] = replacement;
          });
          return object;
        }
        function upgradeUnserializable(destination, source) {
          var _Object$definePropert;
          Object.defineProperties(
            destination,
            ((_Object$definePropert = {}),
            hydration_defineProperty(_Object$definePropert, meta.inspected, {
              configurable: true,
              enumerable: false,
              value: !!source.inspected,
            }),
            hydration_defineProperty(_Object$definePropert, meta.name, {
              configurable: true,
              enumerable: false,
              value: source.name,
            }),
            hydration_defineProperty(_Object$definePropert, meta.preview_long, {
              configurable: true,
              enumerable: false,
              value: source.preview_long,
            }),
            hydration_defineProperty(
              _Object$definePropert,
              meta.preview_short,
              {
                configurable: true,
                enumerable: false,
                value: source.preview_short,
              }
            ),
            hydration_defineProperty(_Object$definePropert, meta.size, {
              configurable: true,
              enumerable: false,
              value: source.size,
            }),
            hydration_defineProperty(_Object$definePropert, meta.readonly, {
              configurable: true,
              enumerable: false,
              value: !!source.readonly,
            }),
            hydration_defineProperty(_Object$definePropert, meta.type, {
              configurable: true,
              enumerable: false,
              value: source.type,
            }),
            hydration_defineProperty(
              _Object$definePropert,
              meta.unserializable,
              {
                configurable: true,
                enumerable: false,
                value: !!source.unserializable,
              }
            ),
            _Object$definePropert)
          );
          delete destination.inspected;
          delete destination.name;
          delete destination.preview_long;
          delete destination.preview_short;
          delete destination.size;
          delete destination.readonly;
          delete destination.type;
          delete destination.unserializable;
        }
        var isArrayImpl = Array.isArray;
        function isArray_isArray(a) {
          return isArrayImpl(a);
        }
        const shared_isArray = isArray_isArray;
        function formatOwnerStack(error) {
          var prevPrepareStackTrace = Error.prepareStackTrace;
          Error.prepareStackTrace = undefined;
          var stack = error.stack;
          Error.prepareStackTrace = prevPrepareStackTrace;
          return formatOwnerStackString(stack);
        }
        function formatOwnerStackString(stack) {
          if (
            stack.startsWith(`Error: react-stack-top-frame
`)
          ) {
            stack = stack.slice(29);
          }
          var idx = stack.indexOf(`
`);
          if (idx !== -1) {
            stack = stack.slice(idx + 1);
          }
          idx = stack.indexOf('react_stack_bottom_frame');
          if (idx === -1) {
            idx = stack.indexOf('react-stack-bottom-frame');
          }
          if (idx !== -1) {
            idx = stack.lastIndexOf(
              `
`,
              idx
            );
          }
          if (idx !== -1) {
            stack = stack.slice(0, idx);
          } else {
            return '';
          }
          return stack;
        }
        function _createForOfIteratorHelper(o, allowArrayLike) {
          var it;
          if (typeof Symbol === 'undefined' || o[Symbol.iterator] == null) {
            if (
              Array.isArray(o) ||
              (it = backend_utils_unsupportedIterableToArray(o)) ||
              (allowArrayLike && o && typeof o.length === 'number')
            ) {
              if (it) o = it;
              var i = 0;
              var F = function F() {};
              return {
                s: F,
                n: function n() {
                  if (i >= o.length) return { done: true };
                  return { done: false, value: o[i++] };
                },
                e: function e(_e2) {
                  throw _e2;
                },
                f: F,
              };
            }
            throw new TypeError(`Invalid attempt to iterate non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
          }
          var normalCompletion = true,
            didErr = false,
            err;
          return {
            s: function s() {
              it = o[Symbol.iterator]();
            },
            n: function n() {
              var step = it.next();
              normalCompletion = step.done;
              return step;
            },
            e: function e(_e3) {
              didErr = true;
              err = _e3;
            },
            f: function f() {
              try {
                if (!normalCompletion && it.return != null) it.return();
              } finally {
                if (didErr) throw err;
              }
            },
          };
        }
        function utils_slicedToArray(arr, i) {
          return (
            utils_arrayWithHoles(arr) ||
            utils_iterableToArrayLimit(arr, i) ||
            backend_utils_unsupportedIterableToArray(arr, i) ||
            utils_nonIterableRest()
          );
        }
        function utils_nonIterableRest() {
          throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function backend_utils_unsupportedIterableToArray(o, minLen) {
          if (!o) return;
          if (typeof o === 'string')
            return backend_utils_arrayLikeToArray(o, minLen);
          var n = Object.prototype.toString.call(o).slice(8, -1);
          if (n === 'Object' && o.constructor) n = o.constructor.name;
          if (n === 'Map' || n === 'Set') return Array.from(o);
          if (
            n === 'Arguments' ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return backend_utils_arrayLikeToArray(o, minLen);
        }
        function backend_utils_arrayLikeToArray(arr, len) {
          if (len == null || len > arr.length) len = arr.length;
          for (var i = 0, arr2 = new Array(len); i < len; i++) {
            arr2[i] = arr[i];
          }
          return arr2;
        }
        function utils_iterableToArrayLimit(arr, i) {
          if (
            typeof Symbol === 'undefined' ||
            !(Symbol.iterator in Object(arr))
          )
            return;
          var _arr = [];
          var _n = true;
          var _d = false;
          var _e = undefined;
          try {
            for (
              var _i = arr[Symbol.iterator](), _s;
              !(_n = (_s = _i.next()).done);
              _n = true
            ) {
              _arr.push(_s.value);
              if (i && _arr.length === i) break;
            }
          } catch (err) {
            _d = true;
            _e = err;
          } finally {
            try {
              if (!_n && _i['return'] != null) _i['return']();
            } finally {
              if (_d) throw _e;
            }
          }
          return _arr;
        }
        function utils_arrayWithHoles(arr) {
          if (Array.isArray(arr)) return arr;
        }
        function backend_utils_typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            backend_utils_typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            backend_utils_typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return backend_utils_typeof(obj);
        }
        function utils_ownKeys(object, enumerableOnly) {
          var keys = Object.keys(object);
          if (Object.getOwnPropertySymbols) {
            var symbols = Object.getOwnPropertySymbols(object);
            if (enumerableOnly)
              symbols = symbols.filter(function (sym) {
                return Object.getOwnPropertyDescriptor(object, sym).enumerable;
              });
            keys.push.apply(keys, symbols);
          }
          return keys;
        }
        function utils_objectSpread(target) {
          for (var i = 1; i < arguments.length; i++) {
            var source = arguments[i] != null ? arguments[i] : {};
            if (i % 2) {
              utils_ownKeys(Object(source), true).forEach(function (key) {
                backend_utils_defineProperty(target, key, source[key]);
              });
            } else if (Object.getOwnPropertyDescriptors) {
              Object.defineProperties(
                target,
                Object.getOwnPropertyDescriptors(source)
              );
            } else {
              utils_ownKeys(Object(source)).forEach(function (key) {
                Object.defineProperty(
                  target,
                  key,
                  Object.getOwnPropertyDescriptor(source, key)
                );
              });
            }
          }
          return target;
        }
        function backend_utils_defineProperty(obj, key, value) {
          if (key in obj) {
            Object.defineProperty(obj, key, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          } else {
            obj[key] = value;
          }
          return obj;
        }
        var FIRST_DEVTOOLS_BACKEND_LOCKSTEP_VER = '999.9.9';
        function hasAssignedBackend(version) {
          if (version == null || version === '') {
            return false;
          }
          return gte(version, FIRST_DEVTOOLS_BACKEND_LOCKSTEP_VER);
        }
        function cleanForBridge(data, isPathAllowed) {
          var path =
            arguments.length > 2 && arguments[2] !== undefined
              ? arguments[2]
              : [];
          if (data !== null) {
            var cleanedPaths = [];
            var unserializablePaths = [];
            var cleanedData = dehydrate(
              data,
              cleanedPaths,
              unserializablePaths,
              path,
              isPathAllowed
            );
            return {
              data: cleanedData,
              cleaned: cleanedPaths,
              unserializable: unserializablePaths,
            };
          } else {
            return null;
          }
        }
        function copyWithDelete(obj, path) {
          var index =
            arguments.length > 2 && arguments[2] !== undefined
              ? arguments[2]
              : 0;
          var key = path[index];
          var updated = shared_isArray(obj)
            ? obj.slice()
            : utils_objectSpread({}, obj);
          if (index + 1 === path.length) {
            if (shared_isArray(updated)) {
              updated.splice(key, 1);
            } else {
              delete updated[key];
            }
          } else {
            updated[key] = copyWithDelete(obj[key], path, index + 1);
          }
          return updated;
        }
        function copyWithRename(obj, oldPath, newPath) {
          var index =
            arguments.length > 3 && arguments[3] !== undefined
              ? arguments[3]
              : 0;
          var oldKey = oldPath[index];
          var updated = shared_isArray(obj)
            ? obj.slice()
            : utils_objectSpread({}, obj);
          if (index + 1 === oldPath.length) {
            var newKey = newPath[index];
            updated[newKey] = updated[oldKey];
            if (shared_isArray(updated)) {
              updated.splice(oldKey, 1);
            } else {
              delete updated[oldKey];
            }
          } else {
            updated[oldKey] = copyWithRename(
              obj[oldKey],
              oldPath,
              newPath,
              index + 1
            );
          }
          return updated;
        }
        function copyWithSet(obj, path, value) {
          var index =
            arguments.length > 3 && arguments[3] !== undefined
              ? arguments[3]
              : 0;
          if (index >= path.length) {
            return value;
          }
          var key = path[index];
          var updated = shared_isArray(obj)
            ? obj.slice()
            : utils_objectSpread({}, obj);
          updated[key] = copyWithSet(obj[key], path, value, index + 1);
          return updated;
        }
        function getEffectDurations(root) {
          var effectDuration = null;
          var passiveEffectDuration = null;
          var hostRoot = root.current;
          if (hostRoot != null) {
            var stateNode = hostRoot.stateNode;
            if (stateNode != null) {
              effectDuration =
                stateNode.effectDuration != null
                  ? stateNode.effectDuration
                  : null;
              passiveEffectDuration =
                stateNode.passiveEffectDuration != null
                  ? stateNode.passiveEffectDuration
                  : null;
            }
          }
          return {
            effectDuration,
            passiveEffectDuration,
          };
        }
        function serializeToString(data) {
          if (data === undefined) {
            return 'undefined';
          }
          if (typeof data === 'function') {
            return data.toString();
          }
          var cache = new Set();
          return JSON.stringify(
            data,
            function (key, value) {
              if (backend_utils_typeof(value) === 'object' && value !== null) {
                if (cache.has(value)) {
                  return;
                }
                cache.add(value);
              }
              if (typeof value === 'bigint') {
                return value.toString() + 'n';
              }
              return value;
            },
            2
          );
        }
        function safeToString(val) {
          try {
            return String(val);
          } catch (err) {
            if (backend_utils_typeof(val) === 'object') {
              return '[object Object]';
            }
            throw err;
          }
        }
        function formatConsoleArgumentsToSingleString(maybeMessage) {
          for (
            var _len = arguments.length,
              inputArgs = new Array(_len > 1 ? _len - 1 : 0),
              _key = 1;
            _key < _len;
            _key++
          ) {
            inputArgs[_key - 1] = arguments[_key];
          }
          var args = inputArgs.slice();
          var formatted = safeToString(maybeMessage);
          if (typeof maybeMessage === 'string') {
            if (args.length) {
              var REGEXP = /(%?)(%([jds]))/g;
              formatted = formatted.replace(
                REGEXP,
                function (match, escaped, ptn, flag) {
                  var arg = args.shift();
                  switch (flag) {
                    case 's':
                      arg += '';
                      break;
                    case 'd':
                    case 'i':
                      arg = parseInt(arg, 10).toString();
                      break;
                    case 'f':
                      arg = parseFloat(arg).toString();
                      break;
                  }
                  if (!escaped) {
                    return arg;
                  }
                  args.unshift(arg);
                  return match;
                }
              );
            }
          }
          if (args.length) {
            for (var i = 0; i < args.length; i++) {
              formatted += ' ' + safeToString(args[i]);
            }
          }
          formatted = formatted.replace(/%{2,2}/g, '%');
          return String(formatted);
        }
        function isSynchronousXHRSupported() {
          return !!(
            window.document &&
            window.document.featurePolicy &&
            window.document.featurePolicy.allowsFeature('sync-xhr')
          );
        }
        function gt() {
          var a =
            arguments.length > 0 && arguments[0] !== undefined
              ? arguments[0]
              : '';
          var b =
            arguments.length > 1 && arguments[1] !== undefined
              ? arguments[1]
              : '';
          return compareVersions(a, b) === 1;
        }
        function gte() {
          var a =
            arguments.length > 0 && arguments[0] !== undefined
              ? arguments[0]
              : '';
          var b =
            arguments.length > 1 && arguments[1] !== undefined
              ? arguments[1]
              : '';
          return compareVersions(a, b) > -1;
        }
        var isReactNativeEnvironment = function isReactNativeEnvironment() {
          return window.document == null;
        };
        function extractLocation(url) {
          if (url.indexOf(':') === -1) {
            return null;
          }
          var withoutParentheses = url.replace(/^\(+/, '').replace(/\)+$/, '');
          var locationParts = /(at )?(.+?)(?::(\d+))?(?::(\d+))?$/.exec(
            withoutParentheses
          );
          if (locationParts == null) {
            return null;
          }
          var _locationParts = utils_slicedToArray(locationParts, 5),
            sourceURL = _locationParts[2],
            line = _locationParts[3],
            column = _locationParts[4];
          return {
            sourceURL,
            line,
            column,
          };
        }
        var CHROME_STACK_REGEXP = /^\s*at .*(\S+:\d+|\(native\))/m;
        function parseSourceFromChromeStack(stack) {
          var frames = stack.split(`
`);
          var _iterator = _createForOfIteratorHelper(frames),
            _step;
          try {
            for (_iterator.s(); !(_step = _iterator.n()).done; ) {
              var frame = _step.value;
              var sanitizedFrame = frame.trim();
              var locationInParenthesesMatch =
                sanitizedFrame.match(/ (\(.+\)$)/);
              var possibleLocation = locationInParenthesesMatch
                ? locationInParenthesesMatch[1]
                : sanitizedFrame;
              var location = extractLocation(possibleLocation);
              if (location == null) {
                continue;
              }
              var { sourceURL, line: _location$line } = location,
                line = _location$line === undefined ? '1' : _location$line,
                _location$column = location.column,
                column =
                  _location$column === undefined ? '1' : _location$column;
              return {
                sourceURL,
                line: parseInt(line, 10),
                column: parseInt(column, 10),
              };
            }
          } catch (err) {
            _iterator.e(err);
          } finally {
            _iterator.f();
          }
          return null;
        }
        function parseSourceFromFirefoxStack(stack) {
          var frames = stack.split(`
`);
          var _iterator2 = _createForOfIteratorHelper(frames),
            _step2;
          try {
            for (_iterator2.s(); !(_step2 = _iterator2.n()).done; ) {
              var frame = _step2.value;
              var sanitizedFrame = frame.trim();
              var frameWithoutFunctionName = sanitizedFrame.replace(
                /((.*".+"[^@]*)?[^@]*)(?:@)/,
                ''
              );
              var location = extractLocation(frameWithoutFunctionName);
              if (location == null) {
                continue;
              }
              var { sourceURL, line: _location$line2 } = location,
                line = _location$line2 === undefined ? '1' : _location$line2,
                _location$column2 = location.column,
                column =
                  _location$column2 === undefined ? '1' : _location$column2;
              return {
                sourceURL,
                line: parseInt(line, 10),
                column: parseInt(column, 10),
              };
            }
          } catch (err) {
            _iterator2.e(err);
          } finally {
            _iterator2.f();
          }
          return null;
        }
        function parseSourceFromComponentStack(componentStack) {
          if (componentStack.match(CHROME_STACK_REGEXP)) {
            return parseSourceFromChromeStack(componentStack);
          }
          return parseSourceFromFirefoxStack(componentStack);
        }
        var collectedLocation = null;
        function collectStackTrace(error, structuredStackTrace) {
          var result = null;
          for (var i = 0; i < structuredStackTrace.length; i++) {
            var callSite = structuredStackTrace[i];
            var _name = callSite.getFunctionName();
            if (
              _name != null &&
              (_name.includes('react_stack_bottom_frame') ||
                _name.includes('react-stack-bottom-frame'))
            ) {
              collectedLocation = result;
              break;
            } else {
              var sourceURL = callSite.getScriptNameOrSourceURL();
              var line =
                typeof callSite.getEnclosingLineNumber === 'function'
                  ? callSite.getEnclosingLineNumber()
                  : callSite.getLineNumber();
              var col =
                typeof callSite.getEnclosingColumnNumber === 'function'
                  ? callSite.getEnclosingColumnNumber()
                  : callSite.getColumnNumber();
              if (!sourceURL || !line || !col) {
                continue;
              }
              result = {
                sourceURL,
                line,
                column: col,
              };
            }
          }
          var name = error.name || 'Error';
          var message = error.message || '';
          var stack = name + ': ' + message;
          for (var _i2 = 0; _i2 < structuredStackTrace.length; _i2++) {
            stack +=
              `
    at ` + structuredStackTrace[_i2].toString();
          }
          return stack;
        }
        function parseSourceFromOwnerStack(error) {
          collectedLocation = null;
          var previousPrepare = Error.prepareStackTrace;
          Error.prepareStackTrace = collectStackTrace;
          var stack;
          try {
            stack = error.stack;
          } catch (e) {
            Error.prepareStackTrace = undefined;
            stack = error.stack;
          } finally {
            Error.prepareStackTrace = previousPrepare;
          }
          if (collectedLocation !== null) {
            return collectedLocation;
          }
          if (stack == null) {
            return null;
          }
          var componentStack = formatOwnerStackString(stack);
          return parseSourceFromComponentStack(componentStack);
        }
        function formatDurationToMicrosecondsGranularity(duration) {
          return Math.round(duration * 1000) / 1000;
        }
        function views_utils_slicedToArray(arr, i) {
          return (
            views_utils_arrayWithHoles(arr) ||
            views_utils_iterableToArrayLimit(arr, i) ||
            views_utils_unsupportedIterableToArray(arr, i) ||
            views_utils_nonIterableRest()
          );
        }
        function views_utils_nonIterableRest() {
          throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function views_utils_unsupportedIterableToArray(o, minLen) {
          if (!o) return;
          if (typeof o === 'string')
            return views_utils_arrayLikeToArray(o, minLen);
          var n = Object.prototype.toString.call(o).slice(8, -1);
          if (n === 'Object' && o.constructor) n = o.constructor.name;
          if (n === 'Map' || n === 'Set') return Array.from(o);
          if (
            n === 'Arguments' ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return views_utils_arrayLikeToArray(o, minLen);
        }
        function views_utils_arrayLikeToArray(arr, len) {
          if (len == null || len > arr.length) len = arr.length;
          for (var i = 0, arr2 = new Array(len); i < len; i++) {
            arr2[i] = arr[i];
          }
          return arr2;
        }
        function views_utils_iterableToArrayLimit(arr, i) {
          if (
            typeof Symbol === 'undefined' ||
            !(Symbol.iterator in Object(arr))
          )
            return;
          var _arr = [];
          var _n = true;
          var _d = false;
          var _e = undefined;
          try {
            for (
              var _i = arr[Symbol.iterator](), _s;
              !(_n = (_s = _i.next()).done);
              _n = true
            ) {
              _arr.push(_s.value);
              if (i && _arr.length === i) break;
            }
          } catch (err) {
            _d = true;
            _e = err;
          } finally {
            try {
              if (!_n && _i['return'] != null) _i['return']();
            } finally {
              if (_d) throw _e;
            }
          }
          return _arr;
        }
        function views_utils_arrayWithHoles(arr) {
          if (Array.isArray(arr)) return arr;
        }
        function getOwnerWindow(node) {
          if (!node.ownerDocument) {
            return null;
          }
          return node.ownerDocument.defaultView;
        }
        function getOwnerIframe(node) {
          var nodeWindow = getOwnerWindow(node);
          if (nodeWindow) {
            return nodeWindow.frameElement;
          }
          return null;
        }
        function getBoundingClientRectWithBorderOffset(node) {
          var dimensions = getElementDimensions(node);
          return mergeRectOffsets([
            node.getBoundingClientRect(),
            {
              top: dimensions.borderTop,
              left: dimensions.borderLeft,
              bottom: dimensions.borderBottom,
              right: dimensions.borderRight,
              width: 0,
              height: 0,
            },
          ]);
        }
        function mergeRectOffsets(rects) {
          return rects.reduce(function (previousRect, rect) {
            if (previousRect == null) {
              return rect;
            }
            return {
              top: previousRect.top + rect.top,
              left: previousRect.left + rect.left,
              width: previousRect.width,
              height: previousRect.height,
              bottom: previousRect.bottom + rect.bottom,
              right: previousRect.right + rect.right,
            };
          });
        }
        function getNestedBoundingClientRect(node, boundaryWindow) {
          var ownerIframe = getOwnerIframe(node);
          if (ownerIframe && ownerIframe !== boundaryWindow) {
            var rects = [node.getBoundingClientRect()];
            var currentIframe = ownerIframe;
            var onlyOneMore = false;
            while (currentIframe) {
              var rect = getBoundingClientRectWithBorderOffset(currentIframe);
              rects.push(rect);
              currentIframe = getOwnerIframe(currentIframe);
              if (onlyOneMore) {
                break;
              }
              if (
                currentIframe &&
                getOwnerWindow(currentIframe) === boundaryWindow
              ) {
                onlyOneMore = true;
              }
            }
            return mergeRectOffsets(rects);
          } else {
            return node.getBoundingClientRect();
          }
        }
        function getElementDimensions(domElement) {
          var calculatedStyle = window.getComputedStyle(domElement);
          return {
            borderLeft: parseInt(calculatedStyle.borderLeftWidth, 10),
            borderRight: parseInt(calculatedStyle.borderRightWidth, 10),
            borderTop: parseInt(calculatedStyle.borderTopWidth, 10),
            borderBottom: parseInt(calculatedStyle.borderBottomWidth, 10),
            marginLeft: parseInt(calculatedStyle.marginLeft, 10),
            marginRight: parseInt(calculatedStyle.marginRight, 10),
            marginTop: parseInt(calculatedStyle.marginTop, 10),
            marginBottom: parseInt(calculatedStyle.marginBottom, 10),
            paddingLeft: parseInt(calculatedStyle.paddingLeft, 10),
            paddingRight: parseInt(calculatedStyle.paddingRight, 10),
            paddingTop: parseInt(calculatedStyle.paddingTop, 10),
            paddingBottom: parseInt(calculatedStyle.paddingBottom, 10),
          };
        }
        function extractHOCNames(displayName) {
          if (!displayName)
            return {
              baseComponentName: '',
              hocNames: [],
            };
          var hocRegex = /([A-Z][a-zA-Z0-9]*?)\((.*)\)/g;
          var hocNames = [];
          var baseComponentName = displayName;
          var match;
          while ((match = hocRegex.exec(baseComponentName)) != null) {
            if (Array.isArray(match)) {
              var _match = match,
                _match2 = views_utils_slicedToArray(_match, 3),
                hocName = _match2[1],
                inner = _match2[2];
              hocNames.push(hocName);
              baseComponentName = inner;
            }
          }
          return {
            baseComponentName,
            hocNames,
          };
        }
        function Overlay_classCallCheck(instance, Constructor) {
          if (!(instance instanceof Constructor)) {
            throw new TypeError('Cannot call a class as a function');
          }
        }
        function Overlay_defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor) descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
          }
        }
        function Overlay_createClass(Constructor, protoProps, staticProps) {
          if (protoProps)
            Overlay_defineProperties(Constructor.prototype, protoProps);
          if (staticProps) Overlay_defineProperties(Constructor, staticProps);
          return Constructor;
        }
        var Overlay_assign = Object.assign;
        var OverlayRect = /* @__PURE__ */ (function () {
          function OverlayRect2(doc, container) {
            Overlay_classCallCheck(this, OverlayRect2);
            this.node = doc.createElement('div');
            this.border = doc.createElement('div');
            this.padding = doc.createElement('div');
            this.content = doc.createElement('div');
            this.border.style.borderColor = overlayStyles.border;
            this.padding.style.borderColor = overlayStyles.padding;
            this.content.style.backgroundColor = overlayStyles.background;
            Overlay_assign(this.node.style, {
              borderColor: overlayStyles.margin,
              pointerEvents: 'none',
              position: 'fixed',
            });
            this.node.style.zIndex = '10000000';
            this.node.appendChild(this.border);
            this.border.appendChild(this.padding);
            this.padding.appendChild(this.content);
            container.appendChild(this.node);
          }
          return Overlay_createClass(OverlayRect2, [
            {
              key: 'remove',
              value: function remove() {
                if (this.node.parentNode) {
                  this.node.parentNode.removeChild(this.node);
                }
              },
            },
            {
              key: 'update',
              value: function update(box, dims) {
                boxWrap(dims, 'margin', this.node);
                boxWrap(dims, 'border', this.border);
                boxWrap(dims, 'padding', this.padding);
                Overlay_assign(this.content.style, {
                  height:
                    box.height -
                    dims.borderTop -
                    dims.borderBottom -
                    dims.paddingTop -
                    dims.paddingBottom +
                    'px',
                  width:
                    box.width -
                    dims.borderLeft -
                    dims.borderRight -
                    dims.paddingLeft -
                    dims.paddingRight +
                    'px',
                });
                Overlay_assign(this.node.style, {
                  top: box.top - dims.marginTop + 'px',
                  left: box.left - dims.marginLeft + 'px',
                });
              },
            },
          ]);
        })();
        var OverlayTip = /* @__PURE__ */ (function () {
          function OverlayTip2(doc, container) {
            Overlay_classCallCheck(this, OverlayTip2);
            this.tip = doc.createElement('div');
            Overlay_assign(this.tip.style, {
              display: 'flex',
              flexFlow: 'row nowrap',
              backgroundColor: '#333740',
              borderRadius: '2px',
              fontFamily:
                '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace',
              fontWeight: 'bold',
              padding: '3px 5px',
              pointerEvents: 'none',
              position: 'fixed',
              fontSize: '12px',
              whiteSpace: 'nowrap',
            });
            this.nameSpan = doc.createElement('span');
            this.tip.appendChild(this.nameSpan);
            Overlay_assign(this.nameSpan.style, {
              color: '#ee78e6',
              borderRight: '1px solid #aaaaaa',
              paddingRight: '0.5rem',
              marginRight: '0.5rem',
            });
            this.dimSpan = doc.createElement('span');
            this.tip.appendChild(this.dimSpan);
            Overlay_assign(this.dimSpan.style, {
              color: '#d7d7d7',
            });
            this.tip.style.zIndex = '10000000';
            container.appendChild(this.tip);
          }
          return Overlay_createClass(OverlayTip2, [
            {
              key: 'remove',
              value: function remove() {
                if (this.tip.parentNode) {
                  this.tip.parentNode.removeChild(this.tip);
                }
              },
            },
            {
              key: 'updateText',
              value: function updateText(name, width, height) {
                this.nameSpan.textContent = name;
                this.dimSpan.textContent =
                  Math.round(width) + 'px × ' + Math.round(height) + 'px';
              },
            },
            {
              key: 'updatePosition',
              value: function updatePosition(dims, bounds) {
                var tipRect = this.tip.getBoundingClientRect();
                var tipPos = findTipPos(dims, bounds, {
                  width: tipRect.width,
                  height: tipRect.height,
                });
                Overlay_assign(this.tip.style, tipPos.style);
              },
            },
          ]);
        })();
        var Overlay = /* @__PURE__ */ (function () {
          function Overlay2(agent2) {
            Overlay_classCallCheck(this, Overlay2);
            var currentWindow =
              window.__REACT_DEVTOOLS_TARGET_WINDOW__ || window;
            this.window = currentWindow;
            var tipBoundsWindow =
              window.__REACT_DEVTOOLS_TARGET_WINDOW__ || window;
            this.tipBoundsWindow = tipBoundsWindow;
            var doc = currentWindow.document;
            this.container = doc.createElement('div');
            this.container.style.zIndex = '10000000';
            this.tip = new OverlayTip(doc, this.container);
            this.rects = [];
            this.agent = agent2;
            doc.body.appendChild(this.container);
          }
          return Overlay_createClass(Overlay2, [
            {
              key: 'remove',
              value: function remove() {
                this.tip.remove();
                this.rects.forEach(function (rect) {
                  rect.remove();
                });
                this.rects.length = 0;
                if (this.container.parentNode) {
                  this.container.parentNode.removeChild(this.container);
                }
              },
            },
            {
              key: 'inspect',
              value: function inspect(nodes, name) {
                var _this = this;
                var elements = nodes.filter(function (node2) {
                  return node2.nodeType === Node.ELEMENT_NODE;
                });
                while (this.rects.length > elements.length) {
                  var rect = this.rects.pop();
                  rect.remove();
                }
                if (elements.length === 0) {
                  return;
                }
                while (this.rects.length < elements.length) {
                  this.rects.push(
                    new OverlayRect(this.window.document, this.container)
                  );
                }
                var outerBox = {
                  top: Number.POSITIVE_INFINITY,
                  right: Number.NEGATIVE_INFINITY,
                  bottom: Number.NEGATIVE_INFINITY,
                  left: Number.POSITIVE_INFINITY,
                };
                elements.forEach(function (element, index) {
                  var box = getNestedBoundingClientRect(element, _this.window);
                  var dims = getElementDimensions(element);
                  outerBox.top = Math.min(
                    outerBox.top,
                    box.top - dims.marginTop
                  );
                  outerBox.right = Math.max(
                    outerBox.right,
                    box.left + box.width + dims.marginRight
                  );
                  outerBox.bottom = Math.max(
                    outerBox.bottom,
                    box.top + box.height + dims.marginBottom
                  );
                  outerBox.left = Math.min(
                    outerBox.left,
                    box.left - dims.marginLeft
                  );
                  var rect2 = _this.rects[index];
                  rect2.update(box, dims);
                });
                if (!name) {
                  name = elements[0].nodeName.toLowerCase();
                  var node = elements[0];
                  var ownerName =
                    this.agent.getComponentNameForHostInstance(node);
                  if (ownerName) {
                    name += ' (in ' + ownerName + ')';
                  }
                }
                this.tip.updateText(
                  name,
                  outerBox.right - outerBox.left,
                  outerBox.bottom - outerBox.top
                );
                var tipBounds = getNestedBoundingClientRect(
                  this.tipBoundsWindow.document.documentElement,
                  this.window
                );
                this.tip.updatePosition(
                  {
                    top: outerBox.top,
                    left: outerBox.left,
                    height: outerBox.bottom - outerBox.top,
                    width: outerBox.right - outerBox.left,
                  },
                  {
                    top: tipBounds.top + this.tipBoundsWindow.scrollY,
                    left: tipBounds.left + this.tipBoundsWindow.scrollX,
                    height: this.tipBoundsWindow.innerHeight,
                    width: this.tipBoundsWindow.innerWidth,
                  }
                );
              },
            },
          ]);
        })();
        function findTipPos(dims, bounds, tipSize) {
          var tipHeight = Math.max(tipSize.height, 20);
          var tipWidth = Math.max(tipSize.width, 60);
          var margin = 5;
          var top;
          if (
            dims.top + dims.height + tipHeight <=
            bounds.top + bounds.height
          ) {
            if (dims.top + dims.height < bounds.top + 0) {
              top = bounds.top + margin;
            } else {
              top = dims.top + dims.height + margin;
            }
          } else if (dims.top - tipHeight <= bounds.top + bounds.height) {
            if (dims.top - tipHeight - margin < bounds.top + margin) {
              top = bounds.top + margin;
            } else {
              top = dims.top - tipHeight - margin;
            }
          } else {
            top = bounds.top + bounds.height - tipHeight - margin;
          }
          var left = dims.left + margin;
          if (dims.left < bounds.left) {
            left = bounds.left + margin;
          }
          if (dims.left + tipWidth > bounds.left + bounds.width) {
            left = bounds.left + bounds.width - tipWidth - margin;
          }
          top += 'px';
          left += 'px';
          return {
            style: {
              top,
              left,
            },
          };
        }
        function boxWrap(dims, what, node) {
          Overlay_assign(node.style, {
            borderTopWidth: dims[what + 'Top'] + 'px',
            borderLeftWidth: dims[what + 'Left'] + 'px',
            borderRightWidth: dims[what + 'Right'] + 'px',
            borderBottomWidth: dims[what + 'Bottom'] + 'px',
            borderStyle: 'solid',
          });
        }
        var overlayStyles = {
          background: 'rgba(120, 170, 210, 0.7)',
          padding: 'rgba(77, 200, 0, 0.3)',
          margin: 'rgba(255, 155, 0, 0.3)',
          border: 'rgba(255, 200, 50, 0.3)',
        };
        var SHOW_DURATION = 2000;
        var timeoutID = null;
        var overlay = null;
        function hideOverlayNative(agent2) {
          agent2.emit('hideNativeHighlight');
        }
        function hideOverlayWeb() {
          timeoutID = null;
          if (overlay !== null) {
            overlay.remove();
            overlay = null;
          }
        }
        function hideOverlay(agent2) {
          return isReactNativeEnvironment()
            ? hideOverlayNative(agent2)
            : hideOverlayWeb();
        }
        function showOverlayNative(elements, agent2) {
          agent2.emit('showNativeHighlight', elements);
        }
        function showOverlayWeb(
          elements,
          componentName,
          agent2,
          hideAfterTimeout
        ) {
          if (timeoutID !== null) {
            clearTimeout(timeoutID);
          }
          if (overlay === null) {
            overlay = new Overlay(agent2);
          }
          overlay.inspect(elements, componentName);
          if (hideAfterTimeout) {
            timeoutID = setTimeout(function () {
              return hideOverlay(agent2);
            }, SHOW_DURATION);
          }
        }
        function showOverlay(
          elements,
          componentName,
          agent2,
          hideAfterTimeout
        ) {
          return isReactNativeEnvironment()
            ? showOverlayNative(elements, agent2)
            : showOverlayWeb(elements, componentName, agent2, hideAfterTimeout);
        }
        var iframesListeningTo = new Set();
        function setupHighlighter(bridge, agent2) {
          bridge.addListener(
            'clearHostInstanceHighlight',
            clearHostInstanceHighlight
          );
          bridge.addListener('highlightHostInstance', highlightHostInstance);
          bridge.addListener('shutdown', stopInspectingHost);
          bridge.addListener('startInspectingHost', startInspectingHost);
          bridge.addListener('stopInspectingHost', stopInspectingHost);
          function startInspectingHost() {
            registerListenersOnWindow(window);
          }
          function registerListenersOnWindow(window2) {
            if (window2 && typeof window2.addEventListener === 'function') {
              window2.addEventListener('click', onClick, true);
              window2.addEventListener('mousedown', onMouseEvent, true);
              window2.addEventListener('mouseover', onMouseEvent, true);
              window2.addEventListener('mouseup', onMouseEvent, true);
              window2.addEventListener('pointerdown', onPointerDown, true);
              window2.addEventListener('pointermove', onPointerMove, true);
              window2.addEventListener('pointerup', onPointerUp, true);
            } else {
              agent2.emit('startInspectingNative');
            }
          }
          function stopInspectingHost() {
            hideOverlay(agent2);
            removeListenersOnWindow(window);
            iframesListeningTo.forEach(function (frame) {
              try {
                removeListenersOnWindow(frame.contentWindow);
              } catch (error) {}
            });
            iframesListeningTo = new Set();
          }
          function removeListenersOnWindow(window2) {
            if (window2 && typeof window2.removeEventListener === 'function') {
              window2.removeEventListener('click', onClick, true);
              window2.removeEventListener('mousedown', onMouseEvent, true);
              window2.removeEventListener('mouseover', onMouseEvent, true);
              window2.removeEventListener('mouseup', onMouseEvent, true);
              window2.removeEventListener('pointerdown', onPointerDown, true);
              window2.removeEventListener('pointermove', onPointerMove, true);
              window2.removeEventListener('pointerup', onPointerUp, true);
            } else {
              agent2.emit('stopInspectingNative');
            }
          }
          function clearHostInstanceHighlight() {
            hideOverlay(agent2);
          }
          function highlightHostInstance(_ref) {
            var {
              displayName,
              hideAfterTimeout,
              id,
              openBuiltinElementsPanel,
              rendererID,
              scrollIntoView,
            } = _ref;
            var renderer = agent2.rendererInterfaces[rendererID];
            if (renderer == null) {
              console.warn(
                'Invalid renderer id "'
                  .concat(rendererID, '" for element "')
                  .concat(id, '"')
              );
              hideOverlay(agent2);
              return;
            }
            if (!renderer.hasElementWithId(id)) {
              hideOverlay(agent2);
              return;
            }
            var nodes = renderer.findHostInstancesForElementID(id);
            if (nodes != null && nodes[0] != null) {
              var node = nodes[0];
              if (scrollIntoView && typeof node.scrollIntoView === 'function') {
                node.scrollIntoView({
                  block: 'nearest',
                  inline: 'nearest',
                });
              }
              showOverlay(nodes, displayName, agent2, hideAfterTimeout);
              if (openBuiltinElementsPanel) {
                window.__REACT_DEVTOOLS_GLOBAL_HOOK__.$0 = node;
                bridge.send('syncSelectionToBuiltinElementsPanel');
              }
            } else {
              hideOverlay(agent2);
            }
          }
          function onClick(event) {
            event.preventDefault();
            event.stopPropagation();
            stopInspectingHost();
            bridge.send('stopInspectingHost', true);
          }
          function onMouseEvent(event) {
            event.preventDefault();
            event.stopPropagation();
          }
          function onPointerDown(event) {
            event.preventDefault();
            event.stopPropagation();
            selectElementForNode(getEventTarget(event));
          }
          var lastHoveredNode = null;
          function onPointerMove(event) {
            event.preventDefault();
            event.stopPropagation();
            var target = getEventTarget(event);
            if (lastHoveredNode === target) return;
            lastHoveredNode = target;
            if (target.tagName === 'IFRAME') {
              var iframe = target;
              try {
                if (!iframesListeningTo.has(iframe)) {
                  var _window = iframe.contentWindow;
                  registerListenersOnWindow(_window);
                  iframesListeningTo.add(iframe);
                }
              } catch (error) {}
            }
            showOverlay([target], null, agent2, false);
            selectElementForNode(target);
          }
          function onPointerUp(event) {
            event.preventDefault();
            event.stopPropagation();
          }
          var selectElementForNode = function selectElementForNode(node) {
            var id = agent2.getIDForHostInstance(node);
            if (id !== null) {
              bridge.send('selectElement', id);
            }
          };
          function getEventTarget(event) {
            if (event.composed) {
              return event.composedPath()[0];
            }
            return event.target;
          }
        }
        function canvas_toConsumableArray(arr) {
          return (
            canvas_arrayWithoutHoles(arr) ||
            canvas_iterableToArray(arr) ||
            canvas_unsupportedIterableToArray(arr) ||
            canvas_nonIterableSpread()
          );
        }
        function canvas_nonIterableSpread() {
          throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function canvas_unsupportedIterableToArray(o, minLen) {
          if (!o) return;
          if (typeof o === 'string') return canvas_arrayLikeToArray(o, minLen);
          var n = Object.prototype.toString.call(o).slice(8, -1);
          if (n === 'Object' && o.constructor) n = o.constructor.name;
          if (n === 'Map' || n === 'Set') return Array.from(o);
          if (
            n === 'Arguments' ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return canvas_arrayLikeToArray(o, minLen);
        }
        function canvas_iterableToArray(iter) {
          if (typeof Symbol !== 'undefined' && Symbol.iterator in Object(iter))
            return Array.from(iter);
        }
        function canvas_arrayWithoutHoles(arr) {
          if (Array.isArray(arr)) return canvas_arrayLikeToArray(arr);
        }
        function canvas_arrayLikeToArray(arr, len) {
          if (len == null || len > arr.length) len = arr.length;
          for (var i = 0, arr2 = new Array(len); i < len; i++) {
            arr2[i] = arr[i];
          }
          return arr2;
        }
        var COLORS = [
          '#37afa9',
          '#63b19e',
          '#80b393',
          '#97b488',
          '#abb67d',
          '#beb771',
          '#cfb965',
          '#dfba57',
          '#efbb49',
          '#febc38',
        ];
        var canvas = null;
        function drawNative(nodeToData2, agent2) {
          var nodesToDraw = [];
          iterateNodes(nodeToData2, function (_ref) {
            var { color, node } = _ref;
            nodesToDraw.push({
              node,
              color,
            });
          });
          agent2.emit('drawTraceUpdates', nodesToDraw);
          var mergedNodes = groupAndSortNodes(nodeToData2);
          agent2.emit('drawGroupedTraceUpdatesWithNames', mergedNodes);
        }
        function drawWeb(nodeToData2) {
          if (canvas === null) {
            initialize();
          }
          var dpr = window.devicePixelRatio || 1;
          var canvasFlow = canvas;
          canvasFlow.width = window.innerWidth * dpr;
          canvasFlow.height = window.innerHeight * dpr;
          canvasFlow.style.width = ''.concat(window.innerWidth, 'px');
          canvasFlow.style.height = ''.concat(window.innerHeight, 'px');
          var context = canvasFlow.getContext('2d');
          context.scale(dpr, dpr);
          context.clearRect(
            0,
            0,
            canvasFlow.width / dpr,
            canvasFlow.height / dpr
          );
          var mergedNodes = groupAndSortNodes(nodeToData2);
          mergedNodes.forEach(function (group) {
            drawGroupBorders(context, group);
            drawGroupLabel(context, group);
          });
          if (canvas !== null) {
            if (nodeToData2.size === 0 && canvas.matches(':popover-open')) {
              canvas.hidePopover();
              return;
            }
            if (canvas.matches(':popover-open')) {
              canvas.hidePopover();
            }
            canvas.showPopover();
          }
        }
        function groupAndSortNodes(nodeToData2) {
          var positionGroups = new Map();
          iterateNodes(nodeToData2, function (_ref2) {
            var _positionGroups$get;
            var { rect, color, displayName, count } = _ref2;
            if (!rect) return;
            var key = ''.concat(rect.left, ',').concat(rect.top);
            if (!positionGroups.has(key)) positionGroups.set(key, []);
            (_positionGroups$get = positionGroups.get(key)) === null ||
              _positionGroups$get === undefined ||
              _positionGroups$get.push({
                rect,
                color,
                displayName,
                count,
              });
          });
          return Array.from(positionGroups.values()).sort(
            function (groupA, groupB) {
              var maxCountA = Math.max.apply(
                Math,
                canvas_toConsumableArray(
                  groupA.map(function (item) {
                    return item.count;
                  })
                )
              );
              var maxCountB = Math.max.apply(
                Math,
                canvas_toConsumableArray(
                  groupB.map(function (item) {
                    return item.count;
                  })
                )
              );
              return maxCountA - maxCountB;
            }
          );
        }
        function drawGroupBorders(context, group) {
          group.forEach(function (_ref3) {
            var { color, rect } = _ref3;
            context.beginPath();
            context.strokeStyle = color;
            context.rect(rect.left, rect.top, rect.width - 1, rect.height - 1);
            context.stroke();
          });
        }
        function drawGroupLabel(context, group) {
          var mergedName = group
            .map(function (_ref4) {
              var { displayName, count } = _ref4;
              return displayName
                ? ''
                    .concat(displayName)
                    .concat(count > 1 ? ' x'.concat(count) : '')
                : '';
            })
            .filter(Boolean)
            .join(', ');
          if (mergedName) {
            drawLabel(context, group[0].rect, mergedName, group[0].color);
          }
        }
        function draw(nodeToData2, agent2) {
          return isReactNativeEnvironment()
            ? drawNative(nodeToData2, agent2)
            : drawWeb(nodeToData2);
        }
        function iterateNodes(nodeToData2, execute) {
          nodeToData2.forEach(function (data, node) {
            var colorIndex = Math.min(COLORS.length - 1, data.count - 1);
            var color = COLORS[colorIndex];
            execute({
              color,
              node,
              count: data.count,
              displayName: data.displayName,
              expirationTime: data.expirationTime,
              lastMeasuredAt: data.lastMeasuredAt,
              rect: data.rect,
            });
          });
        }
        function drawLabel(context, rect, text, color) {
          var { left, top } = rect;
          context.font = '10px monospace';
          context.textBaseline = 'middle';
          context.textAlign = 'center';
          var padding = 2;
          var textHeight = 14;
          var metrics = context.measureText(text);
          var backgroundWidth = metrics.width + padding * 2;
          var backgroundHeight = textHeight;
          var labelX = left;
          var labelY = top - backgroundHeight;
          context.fillStyle = color;
          context.fillRect(labelX, labelY, backgroundWidth, backgroundHeight);
          context.fillStyle = '#000000';
          context.fillText(
            text,
            labelX + backgroundWidth / 2,
            labelY + backgroundHeight / 2
          );
        }
        function destroyNative(agent2) {
          agent2.emit('disableTraceUpdates');
        }
        function destroyWeb() {
          if (canvas !== null) {
            if (canvas.matches(':popover-open')) {
              canvas.hidePopover();
            }
            if (canvas.parentNode != null) {
              canvas.parentNode.removeChild(canvas);
            }
            canvas = null;
          }
        }
        function destroy(agent2) {
          return isReactNativeEnvironment()
            ? destroyNative(agent2)
            : destroyWeb();
        }
        function initialize() {
          canvas = window.document.createElement('canvas');
          canvas.setAttribute('popover', 'manual');
          canvas.style.cssText = `
    xx-background-color: red;
    xx-opacity: 0.5;
    bottom: 0;
    left: 0;
    pointer-events: none;
    position: fixed;
    right: 0;
    top: 0;
    background-color: transparent;
    outline: none;
    box-shadow: none;
    border: none;
  `;
          var root = window.document.documentElement;
          root.insertBefore(canvas, root.firstChild);
        }
        function TraceUpdates_typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            TraceUpdates_typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            TraceUpdates_typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return TraceUpdates_typeof(obj);
        }
        var DISPLAY_DURATION = 250;
        var MAX_DISPLAY_DURATION = 3000;
        var REMEASUREMENT_AFTER_DURATION = 250;
        var HOC_MARKERS = new Map([
          ['Forget', '✨'],
          ['Memo', '\uD83E\uDDE0'],
        ]);
        var getCurrentTime =
          (typeof performance === 'undefined'
            ? 'undefined'
            : TraceUpdates_typeof(performance)) === 'object' &&
          typeof performance.now === 'function'
            ? function () {
                return performance.now();
              }
            : function () {
                return Date.now();
              };
        var nodeToData = new Map();
        var agent = null;
        var drawAnimationFrameID = null;
        var isEnabled = false;
        var redrawTimeoutID = null;
        function TraceUpdates_initialize(injectedAgent) {
          agent = injectedAgent;
          agent.addListener('traceUpdates', traceUpdates);
        }
        function toggleEnabled(value) {
          isEnabled = value;
          if (!isEnabled) {
            nodeToData.clear();
            if (drawAnimationFrameID !== null) {
              cancelAnimationFrame(drawAnimationFrameID);
              drawAnimationFrameID = null;
            }
            if (redrawTimeoutID !== null) {
              clearTimeout(redrawTimeoutID);
              redrawTimeoutID = null;
            }
            destroy(agent);
          }
        }
        function traceUpdates(nodes) {
          if (!isEnabled) return;
          nodes.forEach(function (node) {
            var data = nodeToData.get(node);
            var now = getCurrentTime();
            var lastMeasuredAt = data != null ? data.lastMeasuredAt : 0;
            var rect = data != null ? data.rect : null;
            if (
              rect === null ||
              lastMeasuredAt + REMEASUREMENT_AFTER_DURATION < now
            ) {
              lastMeasuredAt = now;
              rect = measureNode(node);
            }
            var displayName = agent.getComponentNameForHostInstance(node);
            if (displayName) {
              var _extractHOCNames = extractHOCNames(displayName),
                baseComponentName = _extractHOCNames.baseComponentName,
                hocNames = _extractHOCNames.hocNames;
              var markers = hocNames
                .map(function (hoc) {
                  return HOC_MARKERS.get(hoc) || '';
                })
                .join('');
              var enhancedDisplayName = markers
                ? ''.concat(markers).concat(baseComponentName)
                : baseComponentName;
              displayName = enhancedDisplayName;
            }
            nodeToData.set(node, {
              count: data != null ? data.count + 1 : 1,
              expirationTime:
                data != null
                  ? Math.min(
                      now + MAX_DISPLAY_DURATION,
                      data.expirationTime + DISPLAY_DURATION
                    )
                  : now + DISPLAY_DURATION,
              lastMeasuredAt,
              rect,
              displayName,
            });
          });
          if (redrawTimeoutID !== null) {
            clearTimeout(redrawTimeoutID);
            redrawTimeoutID = null;
          }
          if (drawAnimationFrameID === null) {
            drawAnimationFrameID = requestAnimationFrame(prepareToDraw);
          }
        }
        function prepareToDraw() {
          drawAnimationFrameID = null;
          redrawTimeoutID = null;
          var now = getCurrentTime();
          var earliestExpiration = Number.MAX_VALUE;
          nodeToData.forEach(function (data, node) {
            if (data.expirationTime < now) {
              nodeToData.delete(node);
            } else {
              earliestExpiration = Math.min(
                earliestExpiration,
                data.expirationTime
              );
            }
          });
          draw(nodeToData, agent);
          if (earliestExpiration !== Number.MAX_VALUE) {
            redrawTimeoutID = setTimeout(
              prepareToDraw,
              earliestExpiration - now
            );
          }
        }
        function measureNode(node) {
          if (!node || typeof node.getBoundingClientRect !== 'function') {
            return null;
          }
          var currentWindow = window.__REACT_DEVTOOLS_TARGET_WINDOW__ || window;
          return getNestedBoundingClientRect(node, currentWindow);
        }
        function bridge_typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            bridge_typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            bridge_typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return bridge_typeof(obj);
        }
        function bridge_toConsumableArray(arr) {
          return (
            bridge_arrayWithoutHoles(arr) ||
            bridge_iterableToArray(arr) ||
            bridge_unsupportedIterableToArray(arr) ||
            bridge_nonIterableSpread()
          );
        }
        function bridge_nonIterableSpread() {
          throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function bridge_unsupportedIterableToArray(o, minLen) {
          if (!o) return;
          if (typeof o === 'string') return bridge_arrayLikeToArray(o, minLen);
          var n = Object.prototype.toString.call(o).slice(8, -1);
          if (n === 'Object' && o.constructor) n = o.constructor.name;
          if (n === 'Map' || n === 'Set') return Array.from(o);
          if (
            n === 'Arguments' ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return bridge_arrayLikeToArray(o, minLen);
        }
        function bridge_iterableToArray(iter) {
          if (typeof Symbol !== 'undefined' && Symbol.iterator in Object(iter))
            return Array.from(iter);
        }
        function bridge_arrayWithoutHoles(arr) {
          if (Array.isArray(arr)) return bridge_arrayLikeToArray(arr);
        }
        function bridge_arrayLikeToArray(arr, len) {
          if (len == null || len > arr.length) len = arr.length;
          for (var i = 0, arr2 = new Array(len); i < len; i++) {
            arr2[i] = arr[i];
          }
          return arr2;
        }
        function bridge_classCallCheck(instance, Constructor) {
          if (!(instance instanceof Constructor)) {
            throw new TypeError('Cannot call a class as a function');
          }
        }
        function bridge_defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor) descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
          }
        }
        function bridge_createClass(Constructor, protoProps, staticProps) {
          if (protoProps)
            bridge_defineProperties(Constructor.prototype, protoProps);
          if (staticProps) bridge_defineProperties(Constructor, staticProps);
          return Constructor;
        }
        function _callSuper(_this, derived, args) {
          function isNativeReflectConstruct() {
            if (typeof Reflect === 'undefined' || !Reflect.construct)
              return false;
            if (Reflect.construct.sham) return false;
            if (typeof Proxy === 'function') return true;
            try {
              return !Boolean.prototype.valueOf.call(
                Reflect.construct(Boolean, [], function () {})
              );
            } catch (e) {
              return false;
            }
          }
          derived = _getPrototypeOf(derived);
          return _possibleConstructorReturn(
            _this,
            isNativeReflectConstruct()
              ? Reflect.construct(
                  derived,
                  args || [],
                  _getPrototypeOf(_this).constructor
                )
              : derived.apply(_this, args)
          );
        }
        function _possibleConstructorReturn(self2, call) {
          if (
            call &&
            (bridge_typeof(call) === 'object' || typeof call === 'function')
          ) {
            return call;
          }
          return _assertThisInitialized(self2);
        }
        function _assertThisInitialized(self2) {
          if (self2 === undefined) {
            throw new ReferenceError(
              "this hasn't been initialised - super() hasn't been called"
            );
          }
          return self2;
        }
        function _getPrototypeOf(o) {
          _getPrototypeOf = Object.setPrototypeOf
            ? Object.getPrototypeOf
            : function _getPrototypeOf(o2) {
                return o2.__proto__ || Object.getPrototypeOf(o2);
              };
          return _getPrototypeOf(o);
        }
        function _inherits(subClass, superClass) {
          if (typeof superClass !== 'function' && superClass !== null) {
            throw new TypeError(
              'Super expression must either be null or a function'
            );
          }
          subClass.prototype = Object.create(
            superClass && superClass.prototype,
            {
              constructor: {
                value: subClass,
                writable: true,
                configurable: true,
              },
            }
          );
          if (superClass) _setPrototypeOf(subClass, superClass);
        }
        function _setPrototypeOf(o, p) {
          _setPrototypeOf =
            Object.setPrototypeOf ||
            function _setPrototypeOf(o2, p2) {
              o2.__proto__ = p2;
              return o2;
            };
          return _setPrototypeOf(o, p);
        }
        function bridge_defineProperty(obj, key, value) {
          if (key in obj) {
            Object.defineProperty(obj, key, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          } else {
            obj[key] = value;
          }
          return obj;
        }
        var BRIDGE_PROTOCOL = [
          {
            version: 0,
            minNpmVersion: '"<4.11.0"',
            maxNpmVersion: '"<4.11.0"',
          },
          {
            version: 1,
            minNpmVersion: '4.13.0',
            maxNpmVersion: '4.21.0',
          },
          {
            version: 2,
            minNpmVersion: '4.22.0',
            maxNpmVersion: null,
          },
        ];
        var currentBridgeProtocol = BRIDGE_PROTOCOL[BRIDGE_PROTOCOL.length - 1];
        var Bridge = /* @__PURE__ */ (function (_EventEmitter) {
          function Bridge2(wall) {
            var _this2;
            bridge_classCallCheck(this, Bridge2);
            _this2 = _callSuper(this, Bridge2);
            bridge_defineProperty(_this2, '_isShutdown', false);
            bridge_defineProperty(_this2, '_messageQueue', []);
            bridge_defineProperty(_this2, '_scheduledFlush', false);
            bridge_defineProperty(_this2, '_wallUnlisten', null);
            bridge_defineProperty(_this2, '_flush', function () {
              try {
                if (_this2._messageQueue.length) {
                  for (var i = 0; i < _this2._messageQueue.length; i += 2) {
                    var _this2$_wall;
                    (_this2$_wall = _this2._wall).send.apply(
                      _this2$_wall,
                      [_this2._messageQueue[i]].concat(
                        bridge_toConsumableArray(_this2._messageQueue[i + 1])
                      )
                    );
                  }
                  _this2._messageQueue.length = 0;
                }
              } finally {
                _this2._scheduledFlush = false;
              }
            });
            bridge_defineProperty(
              _this2,
              'overrideValueAtPath',
              function (_ref) {
                var { id, path, rendererID, type, value } = _ref;
                switch (type) {
                  case 'context':
                    _this2.send('overrideContext', {
                      id,
                      path,
                      rendererID,
                      wasForwarded: true,
                      value,
                    });
                    break;
                  case 'hooks':
                    _this2.send('overrideHookState', {
                      id,
                      path,
                      rendererID,
                      wasForwarded: true,
                      value,
                    });
                    break;
                  case 'props':
                    _this2.send('overrideProps', {
                      id,
                      path,
                      rendererID,
                      wasForwarded: true,
                      value,
                    });
                    break;
                  case 'state':
                    _this2.send('overrideState', {
                      id,
                      path,
                      rendererID,
                      wasForwarded: true,
                      value,
                    });
                    break;
                }
              }
            );
            _this2._wall = wall;
            _this2._wallUnlisten =
              wall.listen(function (message) {
                if (message && message.event) {
                  _this2.emit(message.event, message.payload);
                }
              }) || null;
            _this2.addListener(
              'overrideValueAtPath',
              _this2.overrideValueAtPath
            );
            return _this2;
          }
          _inherits(Bridge2, _EventEmitter);
          return bridge_createClass(Bridge2, [
            {
              key: 'wall',
              get: function get() {
                return this._wall;
              },
            },
            {
              key: 'send',
              value: function send(event) {
                if (this._isShutdown) {
                  console.warn(
                    'Cannot send message "'.concat(
                      event,
                      '" through a Bridge that has been shutdown.'
                    )
                  );
                  return;
                }
                for (
                  var _len = arguments.length,
                    payload = new Array(_len > 1 ? _len - 1 : 0),
                    _key = 1;
                  _key < _len;
                  _key++
                ) {
                  payload[_key - 1] = arguments[_key];
                }
                this._messageQueue.push(event, payload);
                if (!this._scheduledFlush) {
                  this._scheduledFlush = true;
                  if (typeof devtoolsJestTestScheduler === 'function') {
                    devtoolsJestTestScheduler(this._flush);
                  } else {
                    queueMicrotask(this._flush);
                  }
                }
              },
            },
            {
              key: 'shutdown',
              value: function shutdown() {
                if (this._isShutdown) {
                  console.warn('Bridge was already shutdown.');
                  return;
                }
                this.emit('shutdown');
                this.send('shutdown');
                this._isShutdown = true;
                this.addListener = function () {};
                this.emit = function () {};
                this.removeAllListeners();
                var wallUnlisten = this._wallUnlisten;
                if (wallUnlisten) {
                  wallUnlisten();
                }
                do {
                  this._flush();
                } while (this._messageQueue.length);
              },
            },
          ]);
        })(EventEmitter);
        const src_bridge = Bridge;
        function storage_localStorageGetItem(key) {
          try {
            return localStorage.getItem(key);
          } catch (error) {
            return null;
          }
        }
        function localStorageRemoveItem(key) {
          try {
            localStorage.removeItem(key);
          } catch (error) {}
        }
        function storage_localStorageSetItem(key, value) {
          try {
            return localStorage.setItem(key, value);
          } catch (error) {}
        }
        function storage_sessionStorageGetItem(key) {
          try {
            return sessionStorage.getItem(key);
          } catch (error) {
            return null;
          }
        }
        function storage_sessionStorageRemoveItem(key) {
          try {
            sessionStorage.removeItem(key);
          } catch (error) {}
        }
        function storage_sessionStorageSetItem(key, value) {
          try {
            return sessionStorage.setItem(key, value);
          } catch (error) {}
        }
        function agent_typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            agent_typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            agent_typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return agent_typeof(obj);
        }
        function agent_classCallCheck(instance, Constructor) {
          if (!(instance instanceof Constructor)) {
            throw new TypeError('Cannot call a class as a function');
          }
        }
        function agent_defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor) descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
          }
        }
        function agent_createClass(Constructor, protoProps, staticProps) {
          if (protoProps)
            agent_defineProperties(Constructor.prototype, protoProps);
          if (staticProps) agent_defineProperties(Constructor, staticProps);
          return Constructor;
        }
        function agent_callSuper(_this, derived, args) {
          function isNativeReflectConstruct() {
            if (typeof Reflect === 'undefined' || !Reflect.construct)
              return false;
            if (Reflect.construct.sham) return false;
            if (typeof Proxy === 'function') return true;
            try {
              return !Boolean.prototype.valueOf.call(
                Reflect.construct(Boolean, [], function () {})
              );
            } catch (e) {
              return false;
            }
          }
          derived = agent_getPrototypeOf(derived);
          return agent_possibleConstructorReturn(
            _this,
            isNativeReflectConstruct()
              ? Reflect.construct(
                  derived,
                  args || [],
                  agent_getPrototypeOf(_this).constructor
                )
              : derived.apply(_this, args)
          );
        }
        function agent_possibleConstructorReturn(self2, call) {
          if (
            call &&
            (agent_typeof(call) === 'object' || typeof call === 'function')
          ) {
            return call;
          }
          return agent_assertThisInitialized(self2);
        }
        function agent_assertThisInitialized(self2) {
          if (self2 === undefined) {
            throw new ReferenceError(
              "this hasn't been initialised - super() hasn't been called"
            );
          }
          return self2;
        }
        function agent_getPrototypeOf(o) {
          agent_getPrototypeOf = Object.setPrototypeOf
            ? Object.getPrototypeOf
            : function _getPrototypeOf(o2) {
                return o2.__proto__ || Object.getPrototypeOf(o2);
              };
          return agent_getPrototypeOf(o);
        }
        function agent_inherits(subClass, superClass) {
          if (typeof superClass !== 'function' && superClass !== null) {
            throw new TypeError(
              'Super expression must either be null or a function'
            );
          }
          subClass.prototype = Object.create(
            superClass && superClass.prototype,
            {
              constructor: {
                value: subClass,
                writable: true,
                configurable: true,
              },
            }
          );
          if (superClass) agent_setPrototypeOf(subClass, superClass);
        }
        function agent_setPrototypeOf(o, p) {
          agent_setPrototypeOf =
            Object.setPrototypeOf ||
            function _setPrototypeOf(o2, p2) {
              o2.__proto__ = p2;
              return o2;
            };
          return agent_setPrototypeOf(o, p);
        }
        function agent_defineProperty(obj, key, value) {
          if (key in obj) {
            Object.defineProperty(obj, key, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          } else {
            obj[key] = value;
          }
          return obj;
        }
        var debug = function debug(methodName) {
          if (__DEBUG__) {
            var _console;
            for (
              var _len = arguments.length,
                args = new Array(_len > 1 ? _len - 1 : 0),
                _key = 1;
              _key < _len;
              _key++
            ) {
              args[_key - 1] = arguments[_key];
            }
            (_console = console).log.apply(
              _console,
              [
                '%cAgent %c'.concat(methodName),
                'color: purple; font-weight: bold;',
                'font-weight: bold;',
              ].concat(args)
            );
          }
        };
        var Agent = /* @__PURE__ */ (function (_EventEmitter) {
          function Agent2(bridge) {
            var _this2;
            var isProfiling =
              arguments.length > 1 && arguments[1] !== undefined
                ? arguments[1]
                : false;
            var onReloadAndProfile2 =
              arguments.length > 2 ? arguments[2] : undefined;
            agent_classCallCheck(this, Agent2);
            _this2 = agent_callSuper(this, Agent2);
            agent_defineProperty(_this2, '_isProfiling', false);
            agent_defineProperty(_this2, '_rendererInterfaces', {});
            agent_defineProperty(_this2, '_persistedSelection', null);
            agent_defineProperty(_this2, '_persistedSelectionMatch', null);
            agent_defineProperty(_this2, '_traceUpdatesEnabled', false);
            agent_defineProperty(
              _this2,
              'clearErrorsAndWarnings',
              function (_ref) {
                var rendererID = _ref.rendererID;
                var renderer = _this2._rendererInterfaces[rendererID];
                if (renderer == null) {
                  console.warn('Invalid renderer id "'.concat(rendererID, '"'));
                } else {
                  renderer.clearErrorsAndWarnings();
                }
              }
            );
            agent_defineProperty(
              _this2,
              'clearErrorsForElementID',
              function (_ref2) {
                var { id, rendererID } = _ref2;
                var renderer = _this2._rendererInterfaces[rendererID];
                if (renderer == null) {
                  console.warn('Invalid renderer id "'.concat(rendererID, '"'));
                } else {
                  renderer.clearErrorsForElementID(id);
                }
              }
            );
            agent_defineProperty(
              _this2,
              'clearWarningsForElementID',
              function (_ref3) {
                var { id, rendererID } = _ref3;
                var renderer = _this2._rendererInterfaces[rendererID];
                if (renderer == null) {
                  console.warn('Invalid renderer id "'.concat(rendererID, '"'));
                } else {
                  renderer.clearWarningsForElementID(id);
                }
              }
            );
            agent_defineProperty(_this2, 'copyElementPath', function (_ref4) {
              var { id, path, rendererID } = _ref4;
              var renderer = _this2._rendererInterfaces[rendererID];
              if (renderer == null) {
                console.warn(
                  'Invalid renderer id "'
                    .concat(rendererID, '" for element "')
                    .concat(id, '"')
                );
              } else {
                var value = renderer.getSerializedElementValueByPath(id, path);
                if (value != null) {
                  _this2._bridge.send('saveToClipboard', value);
                } else {
                  console.warn(
                    'Unable to obtain serialized value for element "'.concat(
                      id,
                      '"'
                    )
                  );
                }
              }
            });
            agent_defineProperty(_this2, 'deletePath', function (_ref5) {
              var { hookID, id, path, rendererID, type } = _ref5;
              var renderer = _this2._rendererInterfaces[rendererID];
              if (renderer == null) {
                console.warn(
                  'Invalid renderer id "'
                    .concat(rendererID, '" for element "')
                    .concat(id, '"')
                );
              } else {
                renderer.deletePath(type, id, hookID, path);
              }
            });
            agent_defineProperty(_this2, 'getBackendVersion', function () {
              var version = '6.1.5-5d87cd2244';
              if (version) {
                _this2._bridge.send('backendVersion', version);
              }
            });
            agent_defineProperty(_this2, 'getBridgeProtocol', function () {
              _this2._bridge.send('bridgeProtocol', currentBridgeProtocol);
            });
            agent_defineProperty(_this2, 'getProfilingData', function (_ref6) {
              var rendererID = _ref6.rendererID;
              var renderer = _this2._rendererInterfaces[rendererID];
              if (renderer == null) {
                console.warn('Invalid renderer id "'.concat(rendererID, '"'));
              }
              _this2._bridge.send('profilingData', renderer.getProfilingData());
            });
            agent_defineProperty(_this2, 'getProfilingStatus', function () {
              _this2._bridge.send('profilingStatus', _this2._isProfiling);
            });
            agent_defineProperty(_this2, 'getOwnersList', function (_ref7) {
              var { id, rendererID } = _ref7;
              var renderer = _this2._rendererInterfaces[rendererID];
              if (renderer == null) {
                console.warn(
                  'Invalid renderer id "'
                    .concat(rendererID, '" for element "')
                    .concat(id, '"')
                );
              } else {
                var owners = renderer.getOwnersList(id);
                _this2._bridge.send('ownersList', {
                  id,
                  owners,
                });
              }
            });
            agent_defineProperty(_this2, 'inspectElement', function (_ref8) {
              var { forceFullData, id, path, rendererID, requestID } = _ref8;
              var renderer = _this2._rendererInterfaces[rendererID];
              if (renderer == null) {
                console.warn(
                  'Invalid renderer id "'
                    .concat(rendererID, '" for element "')
                    .concat(id, '"')
                );
              } else {
                _this2._bridge.send(
                  'inspectedElement',
                  renderer.inspectElement(requestID, id, path, forceFullData)
                );
                if (
                  _this2._persistedSelectionMatch === null ||
                  _this2._persistedSelectionMatch.id !== id
                ) {
                  _this2._persistedSelection = null;
                  _this2._persistedSelectionMatch = null;
                  renderer.setTrackedPath(null);
                  _this2._lastSelectedElementID = id;
                  _this2._lastSelectedRendererID = rendererID;
                  if (!_this2._persistSelectionTimerScheduled) {
                    _this2._persistSelectionTimerScheduled = true;
                    setTimeout(_this2._persistSelection, 1000);
                  }
                }
              }
            });
            agent_defineProperty(
              _this2,
              'logElementToConsole',
              function (_ref9) {
                var { id, rendererID } = _ref9;
                var renderer = _this2._rendererInterfaces[rendererID];
                if (renderer == null) {
                  console.warn(
                    'Invalid renderer id "'
                      .concat(rendererID, '" for element "')
                      .concat(id, '"')
                  );
                } else {
                  renderer.logElementToConsole(id);
                }
              }
            );
            agent_defineProperty(_this2, 'overrideError', function (_ref10) {
              var { id, rendererID, forceError } = _ref10;
              var renderer = _this2._rendererInterfaces[rendererID];
              if (renderer == null) {
                console.warn(
                  'Invalid renderer id "'
                    .concat(rendererID, '" for element "')
                    .concat(id, '"')
                );
              } else {
                renderer.overrideError(id, forceError);
              }
            });
            agent_defineProperty(_this2, 'overrideSuspense', function (_ref11) {
              var { id, rendererID, forceFallback } = _ref11;
              var renderer = _this2._rendererInterfaces[rendererID];
              if (renderer == null) {
                console.warn(
                  'Invalid renderer id "'
                    .concat(rendererID, '" for element "')
                    .concat(id, '"')
                );
              } else {
                renderer.overrideSuspense(id, forceFallback);
              }
            });
            agent_defineProperty(
              _this2,
              'overrideValueAtPath',
              function (_ref12) {
                var { hookID, id, path, rendererID, type, value } = _ref12;
                var renderer = _this2._rendererInterfaces[rendererID];
                if (renderer == null) {
                  console.warn(
                    'Invalid renderer id "'
                      .concat(rendererID, '" for element "')
                      .concat(id, '"')
                  );
                } else {
                  renderer.overrideValueAtPath(type, id, hookID, path, value);
                }
              }
            );
            agent_defineProperty(_this2, 'overrideContext', function (_ref13) {
              var { id, path, rendererID, wasForwarded, value } = _ref13;
              if (!wasForwarded) {
                _this2.overrideValueAtPath({
                  id,
                  path,
                  rendererID,
                  type: 'context',
                  value,
                });
              }
            });
            agent_defineProperty(
              _this2,
              'overrideHookState',
              function (_ref14) {
                var { id, hookID, path, rendererID, wasForwarded, value } =
                  _ref14;
                if (!wasForwarded) {
                  _this2.overrideValueAtPath({
                    id,
                    path,
                    rendererID,
                    type: 'hooks',
                    value,
                  });
                }
              }
            );
            agent_defineProperty(_this2, 'overrideProps', function (_ref15) {
              var { id, path, rendererID, wasForwarded, value } = _ref15;
              if (!wasForwarded) {
                _this2.overrideValueAtPath({
                  id,
                  path,
                  rendererID,
                  type: 'props',
                  value,
                });
              }
            });
            agent_defineProperty(_this2, 'overrideState', function (_ref16) {
              var { id, path, rendererID, wasForwarded, value } = _ref16;
              if (!wasForwarded) {
                _this2.overrideValueAtPath({
                  id,
                  path,
                  rendererID,
                  type: 'state',
                  value,
                });
              }
            });
            agent_defineProperty(
              _this2,
              'onReloadAndProfileSupportedByHost',
              function () {
                _this2._bridge.send(
                  'isReloadAndProfileSupportedByBackend',
                  true
                );
              }
            );
            agent_defineProperty(_this2, 'reloadAndProfile', function (_ref17) {
              var { recordChangeDescriptions, recordTimeline } = _ref17;
              if (typeof _this2._onReloadAndProfile === 'function') {
                _this2._onReloadAndProfile(
                  recordChangeDescriptions,
                  recordTimeline
                );
              }
              _this2._bridge.send('reloadAppForProfiling');
            });
            agent_defineProperty(_this2, 'renamePath', function (_ref18) {
              var { hookID, id, newPath, oldPath, rendererID, type } = _ref18;
              var renderer = _this2._rendererInterfaces[rendererID];
              if (renderer == null) {
                console.warn(
                  'Invalid renderer id "'
                    .concat(rendererID, '" for element "')
                    .concat(id, '"')
                );
              } else {
                renderer.renamePath(type, id, hookID, oldPath, newPath);
              }
            });
            agent_defineProperty(
              _this2,
              'setTraceUpdatesEnabled',
              function (traceUpdatesEnabled) {
                _this2._traceUpdatesEnabled = traceUpdatesEnabled;
                toggleEnabled(traceUpdatesEnabled);
                for (var rendererID in _this2._rendererInterfaces) {
                  var renderer = _this2._rendererInterfaces[rendererID];
                  renderer.setTraceUpdatesEnabled(traceUpdatesEnabled);
                }
              }
            );
            agent_defineProperty(
              _this2,
              'syncSelectionFromBuiltinElementsPanel',
              function () {
                var target = window.__REACT_DEVTOOLS_GLOBAL_HOOK__.$0;
                if (target == null) {
                  return;
                }
                _this2.selectNode(target);
              }
            );
            agent_defineProperty(_this2, 'shutdown', function () {
              _this2.emit('shutdown');
              _this2._bridge.removeAllListeners();
              _this2.removeAllListeners();
            });
            agent_defineProperty(_this2, 'startProfiling', function (_ref19) {
              var { recordChangeDescriptions, recordTimeline } = _ref19;
              _this2._isProfiling = true;
              for (var rendererID in _this2._rendererInterfaces) {
                var renderer = _this2._rendererInterfaces[rendererID];
                renderer.startProfiling(
                  recordChangeDescriptions,
                  recordTimeline
                );
              }
              _this2._bridge.send('profilingStatus', _this2._isProfiling);
            });
            agent_defineProperty(_this2, 'stopProfiling', function () {
              _this2._isProfiling = false;
              for (var rendererID in _this2._rendererInterfaces) {
                var renderer = _this2._rendererInterfaces[rendererID];
                renderer.stopProfiling();
              }
              _this2._bridge.send('profilingStatus', _this2._isProfiling);
            });
            agent_defineProperty(
              _this2,
              'stopInspectingNative',
              function (selected) {
                _this2._bridge.send('stopInspectingHost', selected);
              }
            );
            agent_defineProperty(_this2, 'storeAsGlobal', function (_ref20) {
              var { count, id, path, rendererID } = _ref20;
              var renderer = _this2._rendererInterfaces[rendererID];
              if (renderer == null) {
                console.warn(
                  'Invalid renderer id "'
                    .concat(rendererID, '" for element "')
                    .concat(id, '"')
                );
              } else {
                renderer.storeAsGlobal(id, path, count);
              }
            });
            agent_defineProperty(
              _this2,
              'updateHookSettings',
              function (settings) {
                _this2.emit('updateHookSettings', settings);
              }
            );
            agent_defineProperty(_this2, 'getHookSettings', function () {
              _this2.emit('getHookSettings');
            });
            agent_defineProperty(_this2, 'onHookSettings', function (settings) {
              _this2._bridge.send('hookSettings', settings);
            });
            agent_defineProperty(
              _this2,
              'updateComponentFilters',
              function (componentFilters) {
                for (var rendererIDString in _this2._rendererInterfaces) {
                  var rendererID = +rendererIDString;
                  var renderer = _this2._rendererInterfaces[rendererID];
                  if (_this2._lastSelectedRendererID === rendererID) {
                    var path = renderer.getPathForElement(
                      _this2._lastSelectedElementID
                    );
                    if (path !== null) {
                      renderer.setTrackedPath(path);
                      _this2._persistedSelection = {
                        rendererID,
                        path,
                      };
                    }
                  }
                  renderer.updateComponentFilters(componentFilters);
                }
              }
            );
            agent_defineProperty(_this2, 'getEnvironmentNames', function () {
              var accumulatedNames = null;
              for (var rendererID in _this2._rendererInterfaces) {
                var renderer = _this2._rendererInterfaces[+rendererID];
                var names = renderer.getEnvironmentNames();
                if (accumulatedNames === null) {
                  accumulatedNames = names;
                } else {
                  for (var i = 0; i < names.length; i++) {
                    if (accumulatedNames.indexOf(names[i]) === -1) {
                      accumulatedNames.push(names[i]);
                    }
                  }
                }
              }
              _this2._bridge.send('environmentNames', accumulatedNames || []);
            });
            agent_defineProperty(_this2, 'onTraceUpdates', function (nodes) {
              _this2.emit('traceUpdates', nodes);
            });
            agent_defineProperty(_this2, 'onFastRefreshScheduled', function () {
              if (__DEBUG__) {
                debug('onFastRefreshScheduled');
              }
              _this2._bridge.send('fastRefreshScheduled');
            });
            agent_defineProperty(
              _this2,
              'onHookOperations',
              function (operations) {
                if (__DEBUG__) {
                  debug(
                    'onHookOperations',
                    '('
                      .concat(operations.length, ') [')
                      .concat(operations.join(', '), ']')
                  );
                }
                _this2._bridge.send('operations', operations);
                if (_this2._persistedSelection !== null) {
                  var rendererID = operations[0];
                  if (_this2._persistedSelection.rendererID === rendererID) {
                    var renderer = _this2._rendererInterfaces[rendererID];
                    if (renderer == null) {
                      console.warn(
                        'Invalid renderer id "'.concat(rendererID, '"')
                      );
                    } else {
                      var prevMatch = _this2._persistedSelectionMatch;
                      var nextMatch = renderer.getBestMatchForTrackedPath();
                      _this2._persistedSelectionMatch = nextMatch;
                      var prevMatchID =
                        prevMatch !== null ? prevMatch.id : null;
                      var nextMatchID =
                        nextMatch !== null ? nextMatch.id : null;
                      if (prevMatchID !== nextMatchID) {
                        if (nextMatchID !== null) {
                          _this2._bridge.send('selectElement', nextMatchID);
                        }
                      }
                      if (nextMatch !== null && nextMatch.isFullMatch) {
                        _this2._persistedSelection = null;
                        _this2._persistedSelectionMatch = null;
                        renderer.setTrackedPath(null);
                      }
                    }
                  }
                }
              }
            );
            agent_defineProperty(
              _this2,
              'getIfHasUnsupportedRendererVersion',
              function () {
                _this2.emit('getIfHasUnsupportedRendererVersion');
              }
            );
            agent_defineProperty(
              _this2,
              '_persistSelectionTimerScheduled',
              false
            );
            agent_defineProperty(_this2, '_lastSelectedRendererID', -1);
            agent_defineProperty(_this2, '_lastSelectedElementID', -1);
            agent_defineProperty(_this2, '_persistSelection', function () {
              _this2._persistSelectionTimerScheduled = false;
              var rendererID = _this2._lastSelectedRendererID;
              var id = _this2._lastSelectedElementID;
              var renderer = _this2._rendererInterfaces[rendererID];
              var path =
                renderer != null ? renderer.getPathForElement(id) : null;
              if (path !== null) {
                storage_sessionStorageSetItem(
                  SESSION_STORAGE_LAST_SELECTION_KEY,
                  JSON.stringify({
                    rendererID,
                    path,
                  })
                );
              } else {
                storage_sessionStorageRemoveItem(
                  SESSION_STORAGE_LAST_SELECTION_KEY
                );
              }
            });
            _this2._isProfiling = isProfiling;
            _this2._onReloadAndProfile = onReloadAndProfile2;
            var persistedSelectionString = storage_sessionStorageGetItem(
              SESSION_STORAGE_LAST_SELECTION_KEY
            );
            if (persistedSelectionString != null) {
              _this2._persistedSelection = JSON.parse(persistedSelectionString);
            }
            _this2._bridge = bridge;
            bridge.addListener(
              'clearErrorsAndWarnings',
              _this2.clearErrorsAndWarnings
            );
            bridge.addListener(
              'clearErrorsForElementID',
              _this2.clearErrorsForElementID
            );
            bridge.addListener(
              'clearWarningsForElementID',
              _this2.clearWarningsForElementID
            );
            bridge.addListener('copyElementPath', _this2.copyElementPath);
            bridge.addListener('deletePath', _this2.deletePath);
            bridge.addListener('getBackendVersion', _this2.getBackendVersion);
            bridge.addListener('getBridgeProtocol', _this2.getBridgeProtocol);
            bridge.addListener('getProfilingData', _this2.getProfilingData);
            bridge.addListener('getProfilingStatus', _this2.getProfilingStatus);
            bridge.addListener('getOwnersList', _this2.getOwnersList);
            bridge.addListener('inspectElement', _this2.inspectElement);
            bridge.addListener(
              'logElementToConsole',
              _this2.logElementToConsole
            );
            bridge.addListener('overrideError', _this2.overrideError);
            bridge.addListener('overrideSuspense', _this2.overrideSuspense);
            bridge.addListener(
              'overrideValueAtPath',
              _this2.overrideValueAtPath
            );
            bridge.addListener('reloadAndProfile', _this2.reloadAndProfile);
            bridge.addListener('renamePath', _this2.renamePath);
            bridge.addListener(
              'setTraceUpdatesEnabled',
              _this2.setTraceUpdatesEnabled
            );
            bridge.addListener('startProfiling', _this2.startProfiling);
            bridge.addListener('stopProfiling', _this2.stopProfiling);
            bridge.addListener('storeAsGlobal', _this2.storeAsGlobal);
            bridge.addListener(
              'syncSelectionFromBuiltinElementsPanel',
              _this2.syncSelectionFromBuiltinElementsPanel
            );
            bridge.addListener('shutdown', _this2.shutdown);
            bridge.addListener('updateHookSettings', _this2.updateHookSettings);
            bridge.addListener('getHookSettings', _this2.getHookSettings);
            bridge.addListener(
              'updateComponentFilters',
              _this2.updateComponentFilters
            );
            bridge.addListener(
              'getEnvironmentNames',
              _this2.getEnvironmentNames
            );
            bridge.addListener(
              'getIfHasUnsupportedRendererVersion',
              _this2.getIfHasUnsupportedRendererVersion
            );
            bridge.addListener('overrideContext', _this2.overrideContext);
            bridge.addListener('overrideHookState', _this2.overrideHookState);
            bridge.addListener('overrideProps', _this2.overrideProps);
            bridge.addListener('overrideState', _this2.overrideState);
            setupHighlighter(bridge, _this2);
            TraceUpdates_initialize(_this2);
            bridge.send('backendInitialized');
            if (_this2._isProfiling) {
              bridge.send('profilingStatus', true);
            }
            return _this2;
          }
          agent_inherits(Agent2, _EventEmitter);
          return agent_createClass(Agent2, [
            {
              key: 'rendererInterfaces',
              get: function get() {
                return this._rendererInterfaces;
              },
            },
            {
              key: 'getInstanceAndStyle',
              value: function getInstanceAndStyle(_ref21) {
                var { id, rendererID } = _ref21;
                var renderer = this._rendererInterfaces[rendererID];
                if (renderer == null) {
                  console.warn('Invalid renderer id "'.concat(rendererID, '"'));
                  return null;
                }
                return renderer.getInstanceAndStyle(id);
              },
            },
            {
              key: 'getIDForHostInstance',
              value: function getIDForHostInstance(target) {
                if (
                  isReactNativeEnvironment() ||
                  typeof target.nodeType !== 'number'
                ) {
                  for (var rendererID in this._rendererInterfaces) {
                    var renderer = this._rendererInterfaces[rendererID];
                    try {
                      var match = renderer.getElementIDForHostInstance(target);
                      if (match != null) {
                        return match;
                      }
                    } catch (error) {}
                  }
                  return null;
                } else {
                  var bestMatch = null;
                  var bestRenderer = null;
                  for (var _rendererID in this._rendererInterfaces) {
                    var _renderer = this._rendererInterfaces[_rendererID];
                    var nearestNode =
                      _renderer.getNearestMountedDOMNode(target);
                    if (nearestNode !== null) {
                      if (nearestNode === target) {
                        bestMatch = nearestNode;
                        bestRenderer = _renderer;
                        break;
                      }
                      if (
                        bestMatch === null ||
                        bestMatch.contains(nearestNode)
                      ) {
                        bestMatch = nearestNode;
                        bestRenderer = _renderer;
                      }
                    }
                  }
                  if (bestRenderer != null && bestMatch != null) {
                    try {
                      return bestRenderer.getElementIDForHostInstance(
                        bestMatch
                      );
                    } catch (error) {}
                  }
                  return null;
                }
              },
            },
            {
              key: 'getComponentNameForHostInstance',
              value: function getComponentNameForHostInstance(target) {
                if (
                  isReactNativeEnvironment() ||
                  typeof target.nodeType !== 'number'
                ) {
                  for (var rendererID in this._rendererInterfaces) {
                    var renderer = this._rendererInterfaces[rendererID];
                    try {
                      var id = renderer.getElementIDForHostInstance(target);
                      if (id) {
                        return renderer.getDisplayNameForElementID(id);
                      }
                    } catch (error) {}
                  }
                  return null;
                } else {
                  var bestMatch = null;
                  var bestRenderer = null;
                  for (var _rendererID2 in this._rendererInterfaces) {
                    var _renderer2 = this._rendererInterfaces[_rendererID2];
                    var nearestNode =
                      _renderer2.getNearestMountedDOMNode(target);
                    if (nearestNode !== null) {
                      if (nearestNode === target) {
                        bestMatch = nearestNode;
                        bestRenderer = _renderer2;
                        break;
                      }
                      if (
                        bestMatch === null ||
                        bestMatch.contains(nearestNode)
                      ) {
                        bestMatch = nearestNode;
                        bestRenderer = _renderer2;
                      }
                    }
                  }
                  if (bestRenderer != null && bestMatch != null) {
                    try {
                      var _id =
                        bestRenderer.getElementIDForHostInstance(bestMatch);
                      if (_id) {
                        return bestRenderer.getDisplayNameForElementID(_id);
                      }
                    } catch (error) {}
                  }
                  return null;
                }
              },
            },
            {
              key: 'selectNode',
              value: function selectNode(target) {
                var id = this.getIDForHostInstance(target);
                if (id !== null) {
                  this._bridge.send('selectElement', id);
                }
              },
            },
            {
              key: 'registerRendererInterface',
              value: function registerRendererInterface(
                rendererID,
                rendererInterface
              ) {
                this._rendererInterfaces[rendererID] = rendererInterface;
                rendererInterface.setTraceUpdatesEnabled(
                  this._traceUpdatesEnabled
                );
                var selection = this._persistedSelection;
                if (selection !== null && selection.rendererID === rendererID) {
                  rendererInterface.setTrackedPath(selection.path);
                }
              },
            },
            {
              key: 'onUnsupportedRenderer',
              value: function onUnsupportedRenderer() {
                this._bridge.send('unsupportedRendererVersion');
              },
            },
          ]);
        })(EventEmitter);
        function DevToolsConsolePatching_ownKeys(object, enumerableOnly) {
          var keys = Object.keys(object);
          if (Object.getOwnPropertySymbols) {
            var symbols = Object.getOwnPropertySymbols(object);
            if (enumerableOnly)
              symbols = symbols.filter(function (sym) {
                return Object.getOwnPropertyDescriptor(object, sym).enumerable;
              });
            keys.push.apply(keys, symbols);
          }
          return keys;
        }
        function DevToolsConsolePatching_objectSpread(target) {
          for (var i = 1; i < arguments.length; i++) {
            var source = arguments[i] != null ? arguments[i] : {};
            if (i % 2) {
              DevToolsConsolePatching_ownKeys(Object(source), true).forEach(
                function (key) {
                  DevToolsConsolePatching_defineProperty(
                    target,
                    key,
                    source[key]
                  );
                }
              );
            } else if (Object.getOwnPropertyDescriptors) {
              Object.defineProperties(
                target,
                Object.getOwnPropertyDescriptors(source)
              );
            } else {
              DevToolsConsolePatching_ownKeys(Object(source)).forEach(
                function (key) {
                  Object.defineProperty(
                    target,
                    key,
                    Object.getOwnPropertyDescriptor(source, key)
                  );
                }
              );
            }
          }
          return target;
        }
        function DevToolsConsolePatching_defineProperty(obj, key, value) {
          if (key in obj) {
            Object.defineProperty(obj, key, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          } else {
            obj[key] = value;
          }
          return obj;
        }
        var disabledDepth = 0;
        var prevLog;
        var prevInfo;
        var prevWarn;
        var prevError;
        var prevGroup;
        var prevGroupCollapsed;
        var prevGroupEnd;
        function disabledLog() {}
        disabledLog.__reactDisabledLog = true;
        function disableLogs() {
          if (disabledDepth === 0) {
            prevLog = console.log;
            prevInfo = console.info;
            prevWarn = console.warn;
            prevError = console.error;
            prevGroup = console.group;
            prevGroupCollapsed = console.groupCollapsed;
            prevGroupEnd = console.groupEnd;
            var props = {
              configurable: true,
              enumerable: true,
              value: disabledLog,
              writable: true,
            };
            Object.defineProperties(console, {
              info: props,
              log: props,
              warn: props,
              error: props,
              group: props,
              groupCollapsed: props,
              groupEnd: props,
            });
          }
          disabledDepth++;
        }
        function reenableLogs() {
          disabledDepth--;
          if (disabledDepth === 0) {
            var props = {
              configurable: true,
              enumerable: true,
              writable: true,
            };
            Object.defineProperties(console, {
              log: DevToolsConsolePatching_objectSpread(
                DevToolsConsolePatching_objectSpread({}, props),
                {},
                {
                  value: prevLog,
                }
              ),
              info: DevToolsConsolePatching_objectSpread(
                DevToolsConsolePatching_objectSpread({}, props),
                {},
                {
                  value: prevInfo,
                }
              ),
              warn: DevToolsConsolePatching_objectSpread(
                DevToolsConsolePatching_objectSpread({}, props),
                {},
                {
                  value: prevWarn,
                }
              ),
              error: DevToolsConsolePatching_objectSpread(
                DevToolsConsolePatching_objectSpread({}, props),
                {},
                {
                  value: prevError,
                }
              ),
              group: DevToolsConsolePatching_objectSpread(
                DevToolsConsolePatching_objectSpread({}, props),
                {},
                {
                  value: prevGroup,
                }
              ),
              groupCollapsed: DevToolsConsolePatching_objectSpread(
                DevToolsConsolePatching_objectSpread({}, props),
                {},
                {
                  value: prevGroupCollapsed,
                }
              ),
              groupEnd: DevToolsConsolePatching_objectSpread(
                DevToolsConsolePatching_objectSpread({}, props),
                {},
                {
                  value: prevGroupEnd,
                }
              ),
            });
          }
          if (disabledDepth < 0) {
            console.error(
              'disabledDepth fell below zero. ' +
                'This is a bug in React. Please file an issue.'
            );
          }
        }
        function DevToolsComponentStackFrame_slicedToArray(arr, i) {
          return (
            DevToolsComponentStackFrame_arrayWithHoles(arr) ||
            DevToolsComponentStackFrame_iterableToArrayLimit(arr, i) ||
            DevToolsComponentStackFrame_unsupportedIterableToArray(arr, i) ||
            DevToolsComponentStackFrame_nonIterableRest()
          );
        }
        function DevToolsComponentStackFrame_nonIterableRest() {
          throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function DevToolsComponentStackFrame_unsupportedIterableToArray(
          o,
          minLen
        ) {
          if (!o) return;
          if (typeof o === 'string')
            return DevToolsComponentStackFrame_arrayLikeToArray(o, minLen);
          var n = Object.prototype.toString.call(o).slice(8, -1);
          if (n === 'Object' && o.constructor) n = o.constructor.name;
          if (n === 'Map' || n === 'Set') return Array.from(o);
          if (
            n === 'Arguments' ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return DevToolsComponentStackFrame_arrayLikeToArray(o, minLen);
        }
        function DevToolsComponentStackFrame_arrayLikeToArray(arr, len) {
          if (len == null || len > arr.length) len = arr.length;
          for (var i = 0, arr2 = new Array(len); i < len; i++) {
            arr2[i] = arr[i];
          }
          return arr2;
        }
        function DevToolsComponentStackFrame_iterableToArrayLimit(arr, i) {
          if (
            typeof Symbol === 'undefined' ||
            !(Symbol.iterator in Object(arr))
          )
            return;
          var _arr = [];
          var _n = true;
          var _d = false;
          var _e = undefined;
          try {
            for (
              var _i = arr[Symbol.iterator](), _s;
              !(_n = (_s = _i.next()).done);
              _n = true
            ) {
              _arr.push(_s.value);
              if (i && _arr.length === i) break;
            }
          } catch (err) {
            _d = true;
            _e = err;
          } finally {
            try {
              if (!_n && _i['return'] != null) _i['return']();
            } finally {
              if (_d) throw _e;
            }
          }
          return _arr;
        }
        function DevToolsComponentStackFrame_arrayWithHoles(arr) {
          if (Array.isArray(arr)) return arr;
        }
        function DevToolsComponentStackFrame_typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            DevToolsComponentStackFrame_typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            DevToolsComponentStackFrame_typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return DevToolsComponentStackFrame_typeof(obj);
        }
        var prefix;
        function describeBuiltInComponentFrame(name) {
          if (prefix === undefined) {
            try {
              throw Error();
            } catch (x) {
              var match = x.stack.trim().match(/\n( *(at )?)/);
              prefix = (match && match[1]) || '';
            }
          }
          var suffix = '';
          if (true) {
            suffix = ' (<anonymous>)';
          } else {
          }
          return (
            `
` +
            prefix +
            name +
            suffix
          );
        }
        function describeDebugInfoFrame(name, env) {
          return describeBuiltInComponentFrame(
            name + (env ? ' [' + env + ']' : '')
          );
        }
        var reentry = false;
        var componentFrameCache;
        if (false) {
          var PossiblyWeakMap;
        }
        function describeNativeComponentFrame(
          fn,
          construct,
          currentDispatcherRef
        ) {
          if (!fn || reentry) {
            return '';
          }
          if (false) {
            var frame;
          }
          var previousPrepareStackTrace = Error.prepareStackTrace;
          Error.prepareStackTrace = undefined;
          reentry = true;
          var previousDispatcher = currentDispatcherRef.H;
          currentDispatcherRef.H = null;
          disableLogs();
          try {
            var RunInRootFrame = {
              DetermineComponentFrameRoot:
                function DetermineComponentFrameRoot() {
                  var control;
                  try {
                    if (construct) {
                      var Fake = function Fake() {
                        throw Error();
                      };
                      Object.defineProperty(Fake.prototype, 'props', {
                        set: function set() {
                          throw Error();
                        },
                      });
                      if (
                        (typeof Reflect === 'undefined'
                          ? 'undefined'
                          : DevToolsComponentStackFrame_typeof(Reflect)) ===
                          'object' &&
                        Reflect.construct
                      ) {
                        try {
                          Reflect.construct(Fake, []);
                        } catch (x) {
                          control = x;
                        }
                        Reflect.construct(fn, [], Fake);
                      } else {
                        try {
                          Fake.call();
                        } catch (x) {
                          control = x;
                        }
                        fn.call(Fake.prototype);
                      }
                    } else {
                      try {
                        throw Error();
                      } catch (x) {
                        control = x;
                      }
                      var maybePromise = fn();
                      if (
                        maybePromise &&
                        typeof maybePromise.catch === 'function'
                      ) {
                        maybePromise.catch(function () {});
                      }
                    }
                  } catch (sample) {
                    if (sample && control && typeof sample.stack === 'string') {
                      return [sample.stack, control.stack];
                    }
                  }
                  return [null, null];
                },
            };
            RunInRootFrame.DetermineComponentFrameRoot.displayName =
              'DetermineComponentFrameRoot';
            var namePropDescriptor = Object.getOwnPropertyDescriptor(
              RunInRootFrame.DetermineComponentFrameRoot,
              'name'
            );
            if (namePropDescriptor && namePropDescriptor.configurable) {
              Object.defineProperty(
                RunInRootFrame.DetermineComponentFrameRoot,
                'name',
                {
                  value: 'DetermineComponentFrameRoot',
                }
              );
            }
            var _RunInRootFrame$Deter =
                RunInRootFrame.DetermineComponentFrameRoot(),
              _RunInRootFrame$Deter2 =
                DevToolsComponentStackFrame_slicedToArray(
                  _RunInRootFrame$Deter,
                  2
                ),
              sampleStack = _RunInRootFrame$Deter2[0],
              controlStack = _RunInRootFrame$Deter2[1];
            if (sampleStack && controlStack) {
              var sampleLines = sampleStack.split(`
`);
              var controlLines = controlStack.split(`
`);
              var s = 0;
              var c = 0;
              while (
                s < sampleLines.length &&
                !sampleLines[s].includes('DetermineComponentFrameRoot')
              ) {
                s++;
              }
              while (
                c < controlLines.length &&
                !controlLines[c].includes('DetermineComponentFrameRoot')
              ) {
                c++;
              }
              if (s === sampleLines.length || c === controlLines.length) {
                s = sampleLines.length - 1;
                c = controlLines.length - 1;
                while (s >= 1 && c >= 0 && sampleLines[s] !== controlLines[c]) {
                  c--;
                }
              }
              for (; s >= 1 && c >= 0; s--, c--) {
                if (sampleLines[s] !== controlLines[c]) {
                  if (s !== 1 || c !== 1) {
                    do {
                      s--;
                      c--;
                      if (c < 0 || sampleLines[s] !== controlLines[c]) {
                        var _frame =
                          `
` + sampleLines[s].replace(' at new ', ' at ');
                        if (fn.displayName && _frame.includes('<anonymous>')) {
                          _frame = _frame.replace(
                            '<anonymous>',
                            fn.displayName
                          );
                        }
                        if (false) {
                        }
                        return _frame;
                      }
                    } while (s >= 1 && c >= 0);
                  }
                  break;
                }
              }
            }
          } finally {
            reentry = false;
            Error.prepareStackTrace = previousPrepareStackTrace;
            currentDispatcherRef.H = previousDispatcher;
            reenableLogs();
          }
          var name = fn ? fn.displayName || fn.name : '';
          var syntheticFrame = name ? describeBuiltInComponentFrame(name) : '';
          if (false) {
          }
          return syntheticFrame;
        }
        function describeClassComponentFrame(ctor, currentDispatcherRef) {
          return describeNativeComponentFrame(ctor, true, currentDispatcherRef);
        }
        function describeFunctionComponentFrame(fn, currentDispatcherRef) {
          return describeNativeComponentFrame(fn, false, currentDispatcherRef);
        }
        function getOwnerStackByComponentInfoInDev(componentInfo) {
          try {
            var info = '';
            if (
              !componentInfo.owner &&
              typeof componentInfo.name === 'string'
            ) {
              return describeBuiltInComponentFrame(componentInfo.name);
            }
            var owner = componentInfo;
            while (owner) {
              var ownerStack = owner.debugStack;
              if (ownerStack != null) {
                owner = owner.owner;
                if (owner) {
                  info +=
                    `
` + formatOwnerStack(ownerStack);
                }
              } else {
                break;
              }
            }
            return info;
          } catch (x) {
            return (
              `
Error generating stack: ` +
              x.message +
              `
` +
              x.stack
            );
          }
        }
        var componentInfoToComponentLogsMap = new WeakMap();
        function renderer_toConsumableArray(arr) {
          return (
            renderer_arrayWithoutHoles(arr) ||
            renderer_iterableToArray(arr) ||
            renderer_unsupportedIterableToArray(arr) ||
            renderer_nonIterableSpread()
          );
        }
        function renderer_nonIterableSpread() {
          throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function renderer_unsupportedIterableToArray(o, minLen) {
          if (!o) return;
          if (typeof o === 'string')
            return renderer_arrayLikeToArray(o, minLen);
          var n = Object.prototype.toString.call(o).slice(8, -1);
          if (n === 'Object' && o.constructor) n = o.constructor.name;
          if (n === 'Map' || n === 'Set') return Array.from(o);
          if (
            n === 'Arguments' ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return renderer_arrayLikeToArray(o, minLen);
        }
        function renderer_iterableToArray(iter) {
          if (typeof Symbol !== 'undefined' && Symbol.iterator in Object(iter))
            return Array.from(iter);
        }
        function renderer_arrayWithoutHoles(arr) {
          if (Array.isArray(arr)) return renderer_arrayLikeToArray(arr);
        }
        function renderer_arrayLikeToArray(arr, len) {
          if (len == null || len > arr.length) len = arr.length;
          for (var i = 0, arr2 = new Array(len); i < len; i++) {
            arr2[i] = arr[i];
          }
          return arr2;
        }
        function supportsConsoleTasks(componentInfo) {
          return !!componentInfo.debugTask;
        }
        function attach(hook, rendererID, renderer, global2) {
          var getCurrentComponentInfo = renderer.getCurrentComponentInfo;
          function getComponentStack(topFrame) {
            if (getCurrentComponentInfo === undefined) {
              return null;
            }
            var current = getCurrentComponentInfo();
            if (current === null) {
              return null;
            }
            if (supportsConsoleTasks(current)) {
              return null;
            }
            var enableOwnerStacks = current.debugStack != null;
            var componentStack = '';
            if (enableOwnerStacks) {
              var topStackFrames = formatOwnerStack(topFrame);
              if (topStackFrames) {
                componentStack +=
                  `
` + topStackFrames;
              }
              componentStack += getOwnerStackByComponentInfoInDev(current);
            }
            return {
              enableOwnerStacks,
              componentStack,
            };
          }
          function onErrorOrWarning(type, args) {
            if (getCurrentComponentInfo === undefined) {
              return;
            }
            var componentInfo = getCurrentComponentInfo();
            if (componentInfo === null) {
              return;
            }
            if (
              args.length > 3 &&
              typeof args[0] === 'string' &&
              args[0].startsWith('%c%s%c ') &&
              typeof args[1] === 'string' &&
              typeof args[2] === 'string' &&
              typeof args[3] === 'string'
            ) {
              var format = args[0].slice(7);
              var env = args[2].trim();
              args = args.slice(4);
              if (env !== componentInfo.env) {
                args.unshift('[' + env + '] ' + format);
              } else {
                args.unshift(format);
              }
            }
            var message = formatConsoleArgumentsToSingleString.apply(
              undefined,
              renderer_toConsumableArray(args)
            );
            var componentLogsEntry =
              componentInfoToComponentLogsMap.get(componentInfo);
            if (componentLogsEntry === undefined) {
              componentLogsEntry = {
                errors: new Map(),
                errorsCount: 0,
                warnings: new Map(),
                warningsCount: 0,
              };
              componentInfoToComponentLogsMap.set(
                componentInfo,
                componentLogsEntry
              );
            }
            var messageMap =
              type === 'error'
                ? componentLogsEntry.errors
                : componentLogsEntry.warnings;
            var count = messageMap.get(message) || 0;
            messageMap.set(message, count + 1);
            if (type === 'error') {
              componentLogsEntry.errorsCount++;
            } else {
              componentLogsEntry.warningsCount++;
            }
          }
          return {
            cleanup: function cleanup() {},
            clearErrorsAndWarnings: function clearErrorsAndWarnings() {},
            clearErrorsForElementID: function clearErrorsForElementID() {},
            clearWarningsForElementID: function clearWarningsForElementID() {},
            getSerializedElementValueByPath:
              function getSerializedElementValueByPath() {},
            deletePath: function deletePath() {},
            findHostInstancesForElementID:
              function findHostInstancesForElementID() {
                return null;
              },
            flushInitialOperations: function flushInitialOperations() {},
            getBestMatchForTrackedPath: function getBestMatchForTrackedPath() {
              return null;
            },
            getComponentStack,
            getDisplayNameForElementID: function getDisplayNameForElementID() {
              return null;
            },
            getNearestMountedDOMNode: function getNearestMountedDOMNode() {
              return null;
            },
            getElementIDForHostInstance:
              function getElementIDForHostInstance() {
                return null;
              },
            getInstanceAndStyle: function getInstanceAndStyle() {
              return {
                instance: null,
                style: null,
              };
            },
            getOwnersList: function getOwnersList() {
              return null;
            },
            getPathForElement: function getPathForElement() {
              return null;
            },
            getProfilingData: function getProfilingData() {
              throw new Error(
                'getProfilingData not supported by this renderer'
              );
            },
            handleCommitFiberRoot: function handleCommitFiberRoot() {},
            handleCommitFiberUnmount: function handleCommitFiberUnmount() {},
            handlePostCommitFiberRoot: function handlePostCommitFiberRoot() {},
            hasElementWithId: function hasElementWithId() {
              return false;
            },
            inspectElement: function inspectElement(requestID, id, path) {
              return {
                id,
                responseID: requestID,
                type: 'not-found',
              };
            },
            logElementToConsole: function logElementToConsole() {},
            getElementAttributeByPath: function getElementAttributeByPath() {},
            getElementSourceFunctionById:
              function getElementSourceFunctionById() {},
            onErrorOrWarning,
            overrideError: function overrideError() {},
            overrideSuspense: function overrideSuspense() {},
            overrideValueAtPath: function overrideValueAtPath() {},
            renamePath: function renamePath() {},
            renderer,
            setTraceUpdatesEnabled: function setTraceUpdatesEnabled() {},
            setTrackedPath: function setTrackedPath() {},
            startProfiling: function startProfiling() {},
            stopProfiling: function stopProfiling() {},
            storeAsGlobal: function storeAsGlobal() {},
            updateComponentFilters: function updateComponentFilters() {},
            getEnvironmentNames: function getEnvironmentNames() {
              return [];
            },
          };
        }
        var react_debug_tools = __webpack_require__(987);
        var CONCURRENT_MODE_NUMBER = 60111;
        var CONCURRENT_MODE_SYMBOL_STRING = 'Symbol(react.concurrent_mode)';
        var CONTEXT_NUMBER = 60110;
        var CONTEXT_SYMBOL_STRING = 'Symbol(react.context)';
        var SERVER_CONTEXT_SYMBOL_STRING = 'Symbol(react.server_context)';
        var DEPRECATED_ASYNC_MODE_SYMBOL_STRING = 'Symbol(react.async_mode)';
        var ELEMENT_SYMBOL_STRING = 'Symbol(react.transitional.element)';
        var LEGACY_ELEMENT_NUMBER = 60103;
        var LEGACY_ELEMENT_SYMBOL_STRING = 'Symbol(react.element)';
        var DEBUG_TRACING_MODE_NUMBER = 60129;
        var DEBUG_TRACING_MODE_SYMBOL_STRING = 'Symbol(react.debug_trace_mode)';
        var FORWARD_REF_NUMBER = 60112;
        var FORWARD_REF_SYMBOL_STRING = 'Symbol(react.forward_ref)';
        var FRAGMENT_NUMBER = 60107;
        var FRAGMENT_SYMBOL_STRING = 'Symbol(react.fragment)';
        var LAZY_NUMBER = 60116;
        var LAZY_SYMBOL_STRING = 'Symbol(react.lazy)';
        var MEMO_NUMBER = 60115;
        var MEMO_SYMBOL_STRING = 'Symbol(react.memo)';
        var PORTAL_NUMBER = 60106;
        var PORTAL_SYMBOL_STRING = 'Symbol(react.portal)';
        var PROFILER_NUMBER = 60114;
        var PROFILER_SYMBOL_STRING = 'Symbol(react.profiler)';
        var PROVIDER_NUMBER = 60109;
        var PROVIDER_SYMBOL_STRING = 'Symbol(react.provider)';
        var CONSUMER_SYMBOL_STRING = 'Symbol(react.consumer)';
        var SCOPE_NUMBER = 60119;
        var SCOPE_SYMBOL_STRING = 'Symbol(react.scope)';
        var STRICT_MODE_NUMBER = 60108;
        var STRICT_MODE_SYMBOL_STRING = 'Symbol(react.strict_mode)';
        var SUSPENSE_NUMBER = 60113;
        var SUSPENSE_SYMBOL_STRING = 'Symbol(react.suspense)';
        var SUSPENSE_LIST_NUMBER = 60120;
        var SUSPENSE_LIST_SYMBOL_STRING = 'Symbol(react.suspense_list)';
        var SERVER_CONTEXT_DEFAULT_VALUE_NOT_LOADED_SYMBOL_STRING =
          'Symbol(react.server_context.defaultValue)';
        var ReactSymbols_REACT_MEMO_CACHE_SENTINEL = Symbol.for(
          'react.memo_cache_sentinel'
        );
        var enableLogger = false;
        var enableStyleXFeatures = false;
        var isInternalFacebookBuild = false;
        function is(x, y) {
          return (
            (x === y && (x !== 0 || 1 / x === 1 / y)) || (x !== x && y !== y)
          );
        }
        var objectIs = typeof Object.is === 'function' ? Object.is : is;
        const shared_objectIs = objectIs;
        var hasOwnProperty_hasOwnProperty = Object.prototype.hasOwnProperty;
        const shared_hasOwnProperty = hasOwnProperty_hasOwnProperty;
        function describeFiber(
          workTagMap,
          workInProgress,
          currentDispatcherRef
        ) {
          var {
            HostHoistable,
            HostSingleton,
            HostComponent,
            LazyComponent,
            SuspenseComponent,
            SuspenseListComponent,
            FunctionComponent,
            IndeterminateComponent,
            SimpleMemoComponent,
            ForwardRef,
            ClassComponent,
            ViewTransitionComponent,
            ActivityComponent,
          } = workTagMap;
          switch (workInProgress.tag) {
            case HostHoistable:
            case HostSingleton:
            case HostComponent:
              return describeBuiltInComponentFrame(workInProgress.type);
            case LazyComponent:
              return describeBuiltInComponentFrame('Lazy');
            case SuspenseComponent:
              return describeBuiltInComponentFrame('Suspense');
            case SuspenseListComponent:
              return describeBuiltInComponentFrame('SuspenseList');
            case ViewTransitionComponent:
              return describeBuiltInComponentFrame('ViewTransition');
            case ActivityComponent:
              return describeBuiltInComponentFrame('Activity');
            case FunctionComponent:
            case IndeterminateComponent:
            case SimpleMemoComponent:
              return describeFunctionComponentFrame(
                workInProgress.type,
                currentDispatcherRef
              );
            case ForwardRef:
              return describeFunctionComponentFrame(
                workInProgress.type.render,
                currentDispatcherRef
              );
            case ClassComponent:
              return describeClassComponentFrame(
                workInProgress.type,
                currentDispatcherRef
              );
            default:
              return '';
          }
        }
        function getStackByFiberInDevAndProd(
          workTagMap,
          workInProgress,
          currentDispatcherRef
        ) {
          try {
            var info = '';
            var node = workInProgress;
            do {
              info += describeFiber(workTagMap, node, currentDispatcherRef);
              var debugInfo = node._debugInfo;
              if (debugInfo) {
                for (var i = debugInfo.length - 1; i >= 0; i--) {
                  var entry = debugInfo[i];
                  if (typeof entry.name === 'string') {
                    info += describeDebugInfoFrame(entry.name, entry.env);
                  }
                }
              }
              node = node.return;
            } while (node);
            return info;
          } catch (x) {
            return (
              `
Error generating stack: ` +
              x.message +
              `
` +
              x.stack
            );
          }
        }
        function getSourceLocationByFiber(
          workTagMap,
          fiber,
          currentDispatcherRef
        ) {
          try {
            var info = describeFiber(workTagMap, fiber, currentDispatcherRef);
            if (info !== '') {
              return info.slice(1);
            }
          } catch (x) {
            console.error(x);
          }
          return null;
        }
        function DevToolsFiberComponentStack_supportsConsoleTasks(fiber) {
          return !!fiber._debugTask;
        }
        function supportsOwnerStacks(fiber) {
          return fiber._debugStack !== undefined;
        }
        function getOwnerStackByFiberInDev(
          workTagMap,
          workInProgress,
          currentDispatcherRef
        ) {
          var {
            HostHoistable,
            HostSingleton,
            HostText,
            HostComponent,
            SuspenseComponent,
            SuspenseListComponent,
            ViewTransitionComponent,
            ActivityComponent,
          } = workTagMap;
          try {
            var info = '';
            if (workInProgress.tag === HostText) {
              workInProgress = workInProgress.return;
            }
            switch (workInProgress.tag) {
              case HostHoistable:
              case HostSingleton:
              case HostComponent:
                info += describeBuiltInComponentFrame(workInProgress.type);
                break;
              case SuspenseComponent:
                info += describeBuiltInComponentFrame('Suspense');
                break;
              case SuspenseListComponent:
                info += describeBuiltInComponentFrame('SuspenseList');
                break;
              case ViewTransitionComponent:
                info += describeBuiltInComponentFrame('ViewTransition');
                break;
              case ActivityComponent:
                info += describeBuiltInComponentFrame('Activity');
                break;
            }
            var owner = workInProgress;
            while (owner) {
              if (typeof owner.tag === 'number') {
                var fiber = owner;
                owner = fiber._debugOwner;
                var debugStack = fiber._debugStack;
                if (owner && debugStack) {
                  if (typeof debugStack !== 'string') {
                    debugStack = formatOwnerStack(debugStack);
                  }
                  if (debugStack !== '') {
                    info +=
                      `
` + debugStack;
                  }
                }
              } else if (owner.debugStack != null) {
                var ownerStack = owner.debugStack;
                owner = owner.owner;
                if (owner && ownerStack) {
                  info +=
                    `
` + formatOwnerStack(ownerStack);
                }
              } else {
                break;
              }
            }
            return info;
          } catch (x) {
            return (
              `
Error generating stack: ` +
              x.message +
              `
` +
              x.stack
            );
          }
        }
        var cachedStyleNameToValueMap = new Map();
        function getStyleXData(data) {
          var sources = new Set();
          var resolvedStyles = {};
          crawlData(data, sources, resolvedStyles);
          return {
            sources: Array.from(sources).sort(),
            resolvedStyles,
          };
        }
        function crawlData(data, sources, resolvedStyles) {
          if (data == null) {
            return;
          }
          if (src_isArray(data)) {
            data.forEach(function (entry) {
              if (entry == null) {
                return;
              }
              if (src_isArray(entry)) {
                crawlData(entry, sources, resolvedStyles);
              } else {
                crawlObjectProperties(entry, sources, resolvedStyles);
              }
            });
          } else {
            crawlObjectProperties(data, sources, resolvedStyles);
          }
          resolvedStyles = Object.fromEntries(
            Object.entries(resolvedStyles).sort()
          );
        }
        function crawlObjectProperties(entry, sources, resolvedStyles) {
          var keys = Object.keys(entry);
          keys.forEach(function (key) {
            var value = entry[key];
            if (typeof value === 'string') {
              if (key === value) {
                sources.add(key);
              } else {
                var propertyValue = getPropertyValueForStyleName(value);
                if (propertyValue != null) {
                  resolvedStyles[key] = propertyValue;
                }
              }
            } else {
              var nestedStyle = {};
              resolvedStyles[key] = nestedStyle;
              crawlData([value], sources, nestedStyle);
            }
          });
        }
        function getPropertyValueForStyleName(styleName) {
          if (cachedStyleNameToValueMap.has(styleName)) {
            return cachedStyleNameToValueMap.get(styleName);
          }
          for (
            var styleSheetIndex = 0;
            styleSheetIndex < document.styleSheets.length;
            styleSheetIndex++
          ) {
            var styleSheet = document.styleSheets[styleSheetIndex];
            var rules = null;
            try {
              rules = styleSheet.cssRules;
            } catch (_e) {
              continue;
            }
            for (var ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
              if (!(rules[ruleIndex] instanceof CSSStyleRule)) {
                continue;
              }
              var rule = rules[ruleIndex];
              var { cssText, selectorText, style } = rule;
              if (selectorText != null) {
                if (selectorText.startsWith('.'.concat(styleName))) {
                  var match = cssText.match(/{ *([a-z\-]+):/);
                  if (match !== null) {
                    var property = match[1];
                    var value = style.getPropertyValue(property);
                    cachedStyleNameToValueMap.set(styleName, value);
                    return value;
                  } else {
                    return null;
                  }
                }
              }
            }
          }
          return null;
        }
        var CHANGE_LOG_URL =
          'https://github.com/facebook/react/blob/main/packages/react-devtools/CHANGELOG.md';
        var UNSUPPORTED_VERSION_URL =
          'https://reactjs.org/blog/2019/08/15/new-react-devtools.html#how-do-i-get-the-old-version-back';
        var REACT_DEVTOOLS_WORKPLACE_URL =
          'https://fburl.com/react-devtools-workplace-group';
        var THEME_STYLES = {
          light: {
            '--color-attribute-name': '#ef6632',
            '--color-attribute-name-not-editable': '#23272f',
            '--color-attribute-name-inverted': 'rgba(255, 255, 255, 0.7)',
            '--color-attribute-value': '#1a1aa6',
            '--color-attribute-value-inverted': '#ffffff',
            '--color-attribute-editable-value': '#1a1aa6',
            '--color-background': '#ffffff',
            '--color-background-hover': 'rgba(0, 136, 250, 0.1)',
            '--color-background-inactive': '#e5e5e5',
            '--color-background-invalid': '#fff0f0',
            '--color-background-selected': '#0088fa',
            '--color-button-background': '#ffffff',
            '--color-button-background-focus': '#ededed',
            '--color-button-background-hover': 'rgba(0, 0, 0, 0.2)',
            '--color-button': '#5f6673',
            '--color-button-disabled': '#cfd1d5',
            '--color-button-active': '#0088fa',
            '--color-button-focus': '#23272f',
            '--color-button-hover': '#23272f',
            '--color-border': '#eeeeee',
            '--color-commit-did-not-render-fill': '#cfd1d5',
            '--color-commit-did-not-render-fill-text': '#000000',
            '--color-commit-did-not-render-pattern': '#cfd1d5',
            '--color-commit-did-not-render-pattern-text': '#333333',
            '--color-commit-gradient-0': '#37afa9',
            '--color-commit-gradient-1': '#63b19e',
            '--color-commit-gradient-2': '#80b393',
            '--color-commit-gradient-3': '#97b488',
            '--color-commit-gradient-4': '#abb67d',
            '--color-commit-gradient-5': '#beb771',
            '--color-commit-gradient-6': '#cfb965',
            '--color-commit-gradient-7': '#dfba57',
            '--color-commit-gradient-8': '#efbb49',
            '--color-commit-gradient-9': '#febc38',
            '--color-commit-gradient-text': '#000000',
            '--color-component-name': '#6a51b2',
            '--color-component-name-inverted': '#ffffff',
            '--color-component-badge-background': '#e6e6e6',
            '--color-component-badge-background-inverted':
              'rgba(255, 255, 255, 0.25)',
            '--color-component-badge-count': '#777d88',
            '--color-component-badge-count-inverted':
              'rgba(255, 255, 255, 0.7)',
            '--color-console-error-badge-text': '#ffffff',
            '--color-console-error-background': '#fff0f0',
            '--color-console-error-border': '#ffd6d6',
            '--color-console-error-icon': '#eb3941',
            '--color-console-error-text': '#fe2e31',
            '--color-console-warning-badge-text': '#000000',
            '--color-console-warning-background': '#fffbe5',
            '--color-console-warning-border': '#fff5c1',
            '--color-console-warning-icon': '#f4bd00',
            '--color-console-warning-text': '#64460c',
            '--color-context-background': 'rgba(0,0,0,.9)',
            '--color-context-background-hover': 'rgba(255, 255, 255, 0.1)',
            '--color-context-background-selected': '#178fb9',
            '--color-context-border': '#3d424a',
            '--color-context-text': '#ffffff',
            '--color-context-text-selected': '#ffffff',
            '--color-dim': '#777d88',
            '--color-dimmer': '#cfd1d5',
            '--color-dimmest': '#eff0f1',
            '--color-error-background': 'hsl(0, 100%, 97%)',
            '--color-error-border': 'hsl(0, 100%, 92%)',
            '--color-error-text': '#ff0000',
            '--color-expand-collapse-toggle': '#777d88',
            '--color-forget-badge-background': '#2683e2',
            '--color-forget-badge-background-inverted': '#1a6bbc',
            '--color-forget-text': '#fff',
            '--color-link': '#0000ff',
            '--color-modal-background': 'rgba(255, 255, 255, 0.75)',
            '--color-bridge-version-npm-background': '#eff0f1',
            '--color-bridge-version-npm-text': '#000000',
            '--color-bridge-version-number': '#0088fa',
            '--color-primitive-hook-badge-background': '#e5e5e5',
            '--color-primitive-hook-badge-text': '#5f6673',
            '--color-record-active': '#fc3a4b',
            '--color-record-hover': '#3578e5',
            '--color-record-inactive': '#0088fa',
            '--color-resize-bar': '#eeeeee',
            '--color-resize-bar-active': '#dcdcdc',
            '--color-resize-bar-border': '#d1d1d1',
            '--color-resize-bar-dot': '#333333',
            '--color-timeline-internal-module': '#d1d1d1',
            '--color-timeline-internal-module-hover': '#c9c9c9',
            '--color-timeline-internal-module-text': '#444',
            '--color-timeline-native-event': '#ccc',
            '--color-timeline-native-event-hover': '#aaa',
            '--color-timeline-network-primary': '#fcf3dc',
            '--color-timeline-network-primary-hover': '#f0e7d1',
            '--color-timeline-network-secondary': '#efc457',
            '--color-timeline-network-secondary-hover': '#e3ba52',
            '--color-timeline-priority-background': '#f6f6f6',
            '--color-timeline-priority-border': '#eeeeee',
            '--color-timeline-user-timing': '#c9cacd',
            '--color-timeline-user-timing-hover': '#93959a',
            '--color-timeline-react-idle': '#d3e5f6',
            '--color-timeline-react-idle-hover': '#c3d9ef',
            '--color-timeline-react-render': '#9fc3f3',
            '--color-timeline-react-render-hover': '#83afe9',
            '--color-timeline-react-render-text': '#11365e',
            '--color-timeline-react-commit': '#c88ff0',
            '--color-timeline-react-commit-hover': '#b281d6',
            '--color-timeline-react-commit-text': '#3e2c4a',
            '--color-timeline-react-layout-effects': '#b281d6',
            '--color-timeline-react-layout-effects-hover': '#9d71bd',
            '--color-timeline-react-layout-effects-text': '#3e2c4a',
            '--color-timeline-react-passive-effects': '#b281d6',
            '--color-timeline-react-passive-effects-hover': '#9d71bd',
            '--color-timeline-react-passive-effects-text': '#3e2c4a',
            '--color-timeline-react-schedule': '#9fc3f3',
            '--color-timeline-react-schedule-hover': '#2683E2',
            '--color-timeline-react-suspense-rejected': '#f1cc14',
            '--color-timeline-react-suspense-rejected-hover': '#ffdf37',
            '--color-timeline-react-suspense-resolved': '#a6e59f',
            '--color-timeline-react-suspense-resolved-hover': '#89d281',
            '--color-timeline-react-suspense-unresolved': '#c9cacd',
            '--color-timeline-react-suspense-unresolved-hover': '#93959a',
            '--color-timeline-thrown-error': '#ee1638',
            '--color-timeline-thrown-error-hover': '#da1030',
            '--color-timeline-text-color': '#000000',
            '--color-timeline-text-dim-color': '#ccc',
            '--color-timeline-react-work-border': '#eeeeee',
            '--color-search-match': 'yellow',
            '--color-search-match-current': '#f7923b',
            '--color-selected-tree-highlight-active': 'rgba(0, 136, 250, 0.1)',
            '--color-selected-tree-highlight-inactive': 'rgba(0, 0, 0, 0.05)',
            '--color-scroll-caret': 'rgba(150, 150, 150, 0.5)',
            '--color-tab-selected-border': '#0088fa',
            '--color-text': '#000000',
            '--color-text-invalid': '#ff0000',
            '--color-text-selected': '#ffffff',
            '--color-toggle-background-invalid': '#fc3a4b',
            '--color-toggle-background-on': '#0088fa',
            '--color-toggle-background-off': '#cfd1d5',
            '--color-toggle-text': '#ffffff',
            '--color-warning-background': '#fb3655',
            '--color-warning-background-hover': '#f82042',
            '--color-warning-text-color': '#ffffff',
            '--color-warning-text-color-inverted': '#fd4d69',
            '--color-scroll-thumb': '#c2c2c2',
            '--color-scroll-track': '#fafafa',
            '--color-tooltip-background': 'rgba(0, 0, 0, 0.9)',
            '--color-tooltip-text': '#ffffff',
          },
          dark: {
            '--color-attribute-name': '#9d87d2',
            '--color-attribute-name-not-editable': '#ededed',
            '--color-attribute-name-inverted': '#282828',
            '--color-attribute-value': '#cedae0',
            '--color-attribute-value-inverted': '#ffffff',
            '--color-attribute-editable-value': 'yellow',
            '--color-background': '#282c34',
            '--color-background-hover': 'rgba(255, 255, 255, 0.1)',
            '--color-background-inactive': '#3d424a',
            '--color-background-invalid': '#5c0000',
            '--color-background-selected': '#178fb9',
            '--color-button-background': '#282c34',
            '--color-button-background-focus': '#3d424a',
            '--color-button-background-hover': 'rgba(255, 255, 255, 0.2)',
            '--color-button': '#afb3b9',
            '--color-button-active': '#61dafb',
            '--color-button-disabled': '#4f5766',
            '--color-button-focus': '#a2e9fc',
            '--color-button-hover': '#ededed',
            '--color-border': '#3d424a',
            '--color-commit-did-not-render-fill': '#777d88',
            '--color-commit-did-not-render-fill-text': '#000000',
            '--color-commit-did-not-render-pattern': '#666c77',
            '--color-commit-did-not-render-pattern-text': '#ffffff',
            '--color-commit-gradient-0': '#37afa9',
            '--color-commit-gradient-1': '#63b19e',
            '--color-commit-gradient-2': '#80b393',
            '--color-commit-gradient-3': '#97b488',
            '--color-commit-gradient-4': '#abb67d',
            '--color-commit-gradient-5': '#beb771',
            '--color-commit-gradient-6': '#cfb965',
            '--color-commit-gradient-7': '#dfba57',
            '--color-commit-gradient-8': '#efbb49',
            '--color-commit-gradient-9': '#febc38',
            '--color-commit-gradient-text': '#000000',
            '--color-component-name': '#61dafb',
            '--color-component-name-inverted': '#282828',
            '--color-component-badge-background': '#5e6167',
            '--color-component-badge-background-inverted': '#46494e',
            '--color-component-badge-count': '#8f949d',
            '--color-component-badge-count-inverted':
              'rgba(255, 255, 255, 0.85)',
            '--color-console-error-badge-text': '#000000',
            '--color-console-error-background': '#290000',
            '--color-console-error-border': '#5c0000',
            '--color-console-error-icon': '#eb3941',
            '--color-console-error-text': '#fc7f7f',
            '--color-console-warning-badge-text': '#000000',
            '--color-console-warning-background': '#332b00',
            '--color-console-warning-border': '#665500',
            '--color-console-warning-icon': '#f4bd00',
            '--color-console-warning-text': '#f5f2ed',
            '--color-context-background': 'rgba(255,255,255,.95)',
            '--color-context-background-hover': 'rgba(0, 136, 250, 0.1)',
            '--color-context-background-selected': '#0088fa',
            '--color-context-border': '#eeeeee',
            '--color-context-text': '#000000',
            '--color-context-text-selected': '#ffffff',
            '--color-dim': '#8f949d',
            '--color-dimmer': '#777d88',
            '--color-dimmest': '#4f5766',
            '--color-error-background': '#200',
            '--color-error-border': '#900',
            '--color-error-text': '#f55',
            '--color-expand-collapse-toggle': '#8f949d',
            '--color-forget-badge-background': '#2683e2',
            '--color-forget-badge-background-inverted': '#1a6bbc',
            '--color-forget-text': '#fff',
            '--color-link': '#61dafb',
            '--color-modal-background': 'rgba(0, 0, 0, 0.75)',
            '--color-bridge-version-npm-background': 'rgba(0, 0, 0, 0.25)',
            '--color-bridge-version-npm-text': '#ffffff',
            '--color-bridge-version-number': 'yellow',
            '--color-primitive-hook-badge-background': 'rgba(0, 0, 0, 0.25)',
            '--color-primitive-hook-badge-text': 'rgba(255, 255, 255, 0.7)',
            '--color-record-active': '#fc3a4b',
            '--color-record-hover': '#a2e9fc',
            '--color-record-inactive': '#61dafb',
            '--color-resize-bar': '#282c34',
            '--color-resize-bar-active': '#31363f',
            '--color-resize-bar-border': '#3d424a',
            '--color-resize-bar-dot': '#cfd1d5',
            '--color-timeline-internal-module': '#303542',
            '--color-timeline-internal-module-hover': '#363b4a',
            '--color-timeline-internal-module-text': '#7f8899',
            '--color-timeline-native-event': '#b2b2b2',
            '--color-timeline-native-event-hover': '#949494',
            '--color-timeline-network-primary': '#fcf3dc',
            '--color-timeline-network-primary-hover': '#e3dbc5',
            '--color-timeline-network-secondary': '#efc457',
            '--color-timeline-network-secondary-hover': '#d6af4d',
            '--color-timeline-priority-background': '#1d2129',
            '--color-timeline-priority-border': '#282c34',
            '--color-timeline-user-timing': '#c9cacd',
            '--color-timeline-user-timing-hover': '#93959a',
            '--color-timeline-react-idle': '#3d485b',
            '--color-timeline-react-idle-hover': '#465269',
            '--color-timeline-react-render': '#2683E2',
            '--color-timeline-react-render-hover': '#1a76d4',
            '--color-timeline-react-render-text': '#11365e',
            '--color-timeline-react-commit': '#731fad',
            '--color-timeline-react-commit-hover': '#611b94',
            '--color-timeline-react-commit-text': '#e5c1ff',
            '--color-timeline-react-layout-effects': '#611b94',
            '--color-timeline-react-layout-effects-hover': '#51167a',
            '--color-timeline-react-layout-effects-text': '#e5c1ff',
            '--color-timeline-react-passive-effects': '#611b94',
            '--color-timeline-react-passive-effects-hover': '#51167a',
            '--color-timeline-react-passive-effects-text': '#e5c1ff',
            '--color-timeline-react-schedule': '#2683E2',
            '--color-timeline-react-schedule-hover': '#1a76d4',
            '--color-timeline-react-suspense-rejected': '#f1cc14',
            '--color-timeline-react-suspense-rejected-hover': '#e4c00f',
            '--color-timeline-react-suspense-resolved': '#a6e59f',
            '--color-timeline-react-suspense-resolved-hover': '#89d281',
            '--color-timeline-react-suspense-unresolved': '#c9cacd',
            '--color-timeline-react-suspense-unresolved-hover': '#93959a',
            '--color-timeline-thrown-error': '#fb3655',
            '--color-timeline-thrown-error-hover': '#f82042',
            '--color-timeline-text-color': '#282c34',
            '--color-timeline-text-dim-color': '#555b66',
            '--color-timeline-react-work-border': '#3d424a',
            '--color-search-match': 'yellow',
            '--color-search-match-current': '#f7923b',
            '--color-selected-tree-highlight-active':
              'rgba(23, 143, 185, 0.15)',
            '--color-selected-tree-highlight-inactive':
              'rgba(255, 255, 255, 0.05)',
            '--color-scroll-caret': '#4f5766',
            '--color-shadow': 'rgba(0, 0, 0, 0.5)',
            '--color-tab-selected-border': '#178fb9',
            '--color-text': '#ffffff',
            '--color-text-invalid': '#ff8080',
            '--color-text-selected': '#ffffff',
            '--color-toggle-background-invalid': '#fc3a4b',
            '--color-toggle-background-on': '#178fb9',
            '--color-toggle-background-off': '#777d88',
            '--color-toggle-text': '#ffffff',
            '--color-warning-background': '#ee1638',
            '--color-warning-background-hover': '#da1030',
            '--color-warning-text-color': '#ffffff',
            '--color-warning-text-color-inverted': '#ee1638',
            '--color-scroll-thumb': '#afb3b9',
            '--color-scroll-track': '#313640',
            '--color-tooltip-background': 'rgba(255, 255, 255, 0.95)',
            '--color-tooltip-text': '#000000',
          },
          compact: {
            '--font-size-monospace-small': '9px',
            '--font-size-monospace-normal': '11px',
            '--font-size-monospace-large': '15px',
            '--font-size-sans-small': '10px',
            '--font-size-sans-normal': '12px',
            '--font-size-sans-large': '14px',
            '--line-height-data': '18px',
          },
          comfortable: {
            '--font-size-monospace-small': '10px',
            '--font-size-monospace-normal': '13px',
            '--font-size-monospace-large': '17px',
            '--font-size-sans-small': '12px',
            '--font-size-sans-normal': '14px',
            '--font-size-sans-large': '16px',
            '--line-height-data': '22px',
          },
        };
        var COMFORTABLE_LINE_HEIGHT = parseInt(
          THEME_STYLES.comfortable['--line-height-data'],
          10
        );
        var COMPACT_LINE_HEIGHT = parseInt(
          THEME_STYLES.compact['--line-height-data'],
          10
        );
        var REACT_TOTAL_NUM_LANES = 31;
        var SCHEDULING_PROFILER_VERSION = 1;
        var SNAPSHOT_MAX_HEIGHT = 60;
        function profilingHooks_slicedToArray(arr, i) {
          return (
            profilingHooks_arrayWithHoles(arr) ||
            profilingHooks_iterableToArrayLimit(arr, i) ||
            profilingHooks_unsupportedIterableToArray(arr, i) ||
            profilingHooks_nonIterableRest()
          );
        }
        function profilingHooks_nonIterableRest() {
          throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function profilingHooks_unsupportedIterableToArray(o, minLen) {
          if (!o) return;
          if (typeof o === 'string')
            return profilingHooks_arrayLikeToArray(o, minLen);
          var n = Object.prototype.toString.call(o).slice(8, -1);
          if (n === 'Object' && o.constructor) n = o.constructor.name;
          if (n === 'Map' || n === 'Set') return Array.from(o);
          if (
            n === 'Arguments' ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return profilingHooks_arrayLikeToArray(o, minLen);
        }
        function profilingHooks_arrayLikeToArray(arr, len) {
          if (len == null || len > arr.length) len = arr.length;
          for (var i = 0, arr2 = new Array(len); i < len; i++) {
            arr2[i] = arr[i];
          }
          return arr2;
        }
        function profilingHooks_iterableToArrayLimit(arr, i) {
          if (
            typeof Symbol === 'undefined' ||
            !(Symbol.iterator in Object(arr))
          )
            return;
          var _arr = [];
          var _n = true;
          var _d = false;
          var _e = undefined;
          try {
            for (
              var _i = arr[Symbol.iterator](), _s;
              !(_n = (_s = _i.next()).done);
              _n = true
            ) {
              _arr.push(_s.value);
              if (i && _arr.length === i) break;
            }
          } catch (err) {
            _d = true;
            _e = err;
          } finally {
            try {
              if (!_n && _i['return'] != null) _i['return']();
            } finally {
              if (_d) throw _e;
            }
          }
          return _arr;
        }
        function profilingHooks_arrayWithHoles(arr) {
          if (Array.isArray(arr)) return arr;
        }
        function profilingHooks_typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            profilingHooks_typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            profilingHooks_typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return profilingHooks_typeof(obj);
        }
        var TIME_OFFSET = 10;
        var performanceTarget = null;
        var supportsUserTiming =
          typeof performance !== 'undefined' &&
          typeof performance.mark === 'function' &&
          typeof performance.clearMarks === 'function';
        var supportsUserTimingV3 = false;
        if (supportsUserTiming) {
          var CHECK_V3_MARK = '__v3';
          var markOptions = {};
          Object.defineProperty(markOptions, 'startTime', {
            get: function get() {
              supportsUserTimingV3 = true;
              return 0;
            },
            set: function set() {},
          });
          try {
            performance.mark(CHECK_V3_MARK, markOptions);
          } catch (error) {
          } finally {
            performance.clearMarks(CHECK_V3_MARK);
          }
        }
        if (supportsUserTimingV3) {
          performanceTarget = performance;
        }
        var profilingHooks_getCurrentTime =
          (typeof performance === 'undefined'
            ? 'undefined'
            : profilingHooks_typeof(performance)) === 'object' &&
          typeof performance.now === 'function'
            ? function () {
                return performance.now();
              }
            : function () {
                return Date.now();
              };
        function setPerformanceMock_ONLY_FOR_TESTING(performanceMock) {
          performanceTarget = performanceMock;
          supportsUserTiming = performanceMock !== null;
          supportsUserTimingV3 = performanceMock !== null;
        }
        function createProfilingHooks(_ref) {
          var {
            getDisplayNameForFiber,
            getIsProfiling,
            getLaneLabelMap,
            workTagMap,
            currentDispatcherRef,
            reactVersion,
          } = _ref;
          var currentBatchUID = 0;
          var currentReactComponentMeasure = null;
          var currentReactMeasuresStack = [];
          var currentTimelineData = null;
          var currentFiberStacks = new Map();
          var isProfiling = false;
          var nextRenderShouldStartNewBatch = false;
          function getRelativeTime() {
            var currentTime = profilingHooks_getCurrentTime();
            if (currentTimelineData) {
              if (currentTimelineData.startTime === 0) {
                currentTimelineData.startTime = currentTime - TIME_OFFSET;
              }
              return currentTime - currentTimelineData.startTime;
            }
            return 0;
          }
          function getInternalModuleRanges() {
            if (
              typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined' &&
              typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.getInternalModuleRanges ===
                'function'
            ) {
              var ranges =
                __REACT_DEVTOOLS_GLOBAL_HOOK__.getInternalModuleRanges();
              if (shared_isArray(ranges)) {
                return ranges;
              }
            }
            return null;
          }
          function getTimelineData() {
            return currentTimelineData;
          }
          function laneToLanesArray(lanes) {
            var lanesArray = [];
            var lane = 1;
            for (var index = 0; index < REACT_TOTAL_NUM_LANES; index++) {
              if (lane & lanes) {
                lanesArray.push(lane);
              }
              lane *= 2;
            }
            return lanesArray;
          }
          var laneToLabelMap =
            typeof getLaneLabelMap === 'function' ? getLaneLabelMap() : null;
          function markMetadata() {
            markAndClear('--react-version-'.concat(reactVersion));
            markAndClear(
              '--profiler-version-'.concat(SCHEDULING_PROFILER_VERSION)
            );
            var ranges = getInternalModuleRanges();
            if (ranges) {
              for (var i = 0; i < ranges.length; i++) {
                var range = ranges[i];
                if (shared_isArray(range) && range.length === 2) {
                  var _ranges$i = profilingHooks_slicedToArray(ranges[i], 2),
                    startStackFrame = _ranges$i[0],
                    stopStackFrame = _ranges$i[1];
                  markAndClear(
                    '--react-internal-module-start-'.concat(startStackFrame)
                  );
                  markAndClear(
                    '--react-internal-module-stop-'.concat(stopStackFrame)
                  );
                }
              }
            }
            if (laneToLabelMap != null) {
              var labels = Array.from(laneToLabelMap.values()).join(',');
              markAndClear('--react-lane-labels-'.concat(labels));
            }
          }
          function markAndClear(markName) {
            performanceTarget.mark(markName);
            performanceTarget.clearMarks(markName);
          }
          function recordReactMeasureStarted(type, lanes) {
            var depth = 0;
            if (currentReactMeasuresStack.length > 0) {
              var top =
                currentReactMeasuresStack[currentReactMeasuresStack.length - 1];
              depth = top.type === 'render-idle' ? top.depth : top.depth + 1;
            }
            var lanesArray = laneToLanesArray(lanes);
            var reactMeasure = {
              type,
              batchUID: currentBatchUID,
              depth,
              lanes: lanesArray,
              timestamp: getRelativeTime(),
              duration: 0,
            };
            currentReactMeasuresStack.push(reactMeasure);
            if (currentTimelineData) {
              var _currentTimelineData = currentTimelineData,
                batchUIDToMeasuresMap =
                  _currentTimelineData.batchUIDToMeasuresMap,
                laneToReactMeasureMap =
                  _currentTimelineData.laneToReactMeasureMap;
              var reactMeasures = batchUIDToMeasuresMap.get(currentBatchUID);
              if (reactMeasures != null) {
                reactMeasures.push(reactMeasure);
              } else {
                batchUIDToMeasuresMap.set(currentBatchUID, [reactMeasure]);
              }
              lanesArray.forEach(function (lane) {
                reactMeasures = laneToReactMeasureMap.get(lane);
                if (reactMeasures) {
                  reactMeasures.push(reactMeasure);
                }
              });
            }
          }
          function recordReactMeasureCompleted(type) {
            var currentTime = getRelativeTime();
            if (currentReactMeasuresStack.length === 0) {
              console.error(
                'Unexpected type "%s" completed at %sms while currentReactMeasuresStack is empty.',
                type,
                currentTime
              );
              return;
            }
            var top = currentReactMeasuresStack.pop();
            if (top.type !== type) {
              console.error(
                'Unexpected type "%s" completed at %sms before "%s" completed.',
                type,
                currentTime,
                top.type
              );
            }
            top.duration = currentTime - top.timestamp;
            if (currentTimelineData) {
              currentTimelineData.duration = getRelativeTime() + TIME_OFFSET;
            }
          }
          function markCommitStarted(lanes) {
            if (!isProfiling) {
              return;
            }
            recordReactMeasureStarted('commit', lanes);
            nextRenderShouldStartNewBatch = true;
            if (supportsUserTimingV3) {
              markAndClear('--commit-start-'.concat(lanes));
              markMetadata();
            }
          }
          function markCommitStopped() {
            if (!isProfiling) {
              return;
            }
            recordReactMeasureCompleted('commit');
            recordReactMeasureCompleted('render-idle');
            if (supportsUserTimingV3) {
              markAndClear('--commit-stop');
            }
          }
          function markComponentRenderStarted(fiber) {
            if (!isProfiling) {
              return;
            }
            var componentName = getDisplayNameForFiber(fiber) || 'Unknown';
            currentReactComponentMeasure = {
              componentName,
              duration: 0,
              timestamp: getRelativeTime(),
              type: 'render',
              warning: null,
            };
            if (supportsUserTimingV3) {
              markAndClear('--component-render-start-'.concat(componentName));
            }
          }
          function markComponentRenderStopped() {
            if (!isProfiling) {
              return;
            }
            if (currentReactComponentMeasure) {
              if (currentTimelineData) {
                currentTimelineData.componentMeasures.push(
                  currentReactComponentMeasure
                );
              }
              currentReactComponentMeasure.duration =
                getRelativeTime() - currentReactComponentMeasure.timestamp;
              currentReactComponentMeasure = null;
            }
            if (supportsUserTimingV3) {
              markAndClear('--component-render-stop');
            }
          }
          function markComponentLayoutEffectMountStarted(fiber) {
            if (!isProfiling) {
              return;
            }
            var componentName = getDisplayNameForFiber(fiber) || 'Unknown';
            currentReactComponentMeasure = {
              componentName,
              duration: 0,
              timestamp: getRelativeTime(),
              type: 'layout-effect-mount',
              warning: null,
            };
            if (supportsUserTimingV3) {
              markAndClear(
                '--component-layout-effect-mount-start-'.concat(componentName)
              );
            }
          }
          function markComponentLayoutEffectMountStopped() {
            if (!isProfiling) {
              return;
            }
            if (currentReactComponentMeasure) {
              if (currentTimelineData) {
                currentTimelineData.componentMeasures.push(
                  currentReactComponentMeasure
                );
              }
              currentReactComponentMeasure.duration =
                getRelativeTime() - currentReactComponentMeasure.timestamp;
              currentReactComponentMeasure = null;
            }
            if (supportsUserTimingV3) {
              markAndClear('--component-layout-effect-mount-stop');
            }
          }
          function markComponentLayoutEffectUnmountStarted(fiber) {
            if (!isProfiling) {
              return;
            }
            var componentName = getDisplayNameForFiber(fiber) || 'Unknown';
            currentReactComponentMeasure = {
              componentName,
              duration: 0,
              timestamp: getRelativeTime(),
              type: 'layout-effect-unmount',
              warning: null,
            };
            if (supportsUserTimingV3) {
              markAndClear(
                '--component-layout-effect-unmount-start-'.concat(componentName)
              );
            }
          }
          function markComponentLayoutEffectUnmountStopped() {
            if (!isProfiling) {
              return;
            }
            if (currentReactComponentMeasure) {
              if (currentTimelineData) {
                currentTimelineData.componentMeasures.push(
                  currentReactComponentMeasure
                );
              }
              currentReactComponentMeasure.duration =
                getRelativeTime() - currentReactComponentMeasure.timestamp;
              currentReactComponentMeasure = null;
            }
            if (supportsUserTimingV3) {
              markAndClear('--component-layout-effect-unmount-stop');
            }
          }
          function markComponentPassiveEffectMountStarted(fiber) {
            if (!isProfiling) {
              return;
            }
            var componentName = getDisplayNameForFiber(fiber) || 'Unknown';
            currentReactComponentMeasure = {
              componentName,
              duration: 0,
              timestamp: getRelativeTime(),
              type: 'passive-effect-mount',
              warning: null,
            };
            if (supportsUserTimingV3) {
              markAndClear(
                '--component-passive-effect-mount-start-'.concat(componentName)
              );
            }
          }
          function markComponentPassiveEffectMountStopped() {
            if (!isProfiling) {
              return;
            }
            if (currentReactComponentMeasure) {
              if (currentTimelineData) {
                currentTimelineData.componentMeasures.push(
                  currentReactComponentMeasure
                );
              }
              currentReactComponentMeasure.duration =
                getRelativeTime() - currentReactComponentMeasure.timestamp;
              currentReactComponentMeasure = null;
            }
            if (supportsUserTimingV3) {
              markAndClear('--component-passive-effect-mount-stop');
            }
          }
          function markComponentPassiveEffectUnmountStarted(fiber) {
            if (!isProfiling) {
              return;
            }
            var componentName = getDisplayNameForFiber(fiber) || 'Unknown';
            currentReactComponentMeasure = {
              componentName,
              duration: 0,
              timestamp: getRelativeTime(),
              type: 'passive-effect-unmount',
              warning: null,
            };
            if (supportsUserTimingV3) {
              markAndClear(
                '--component-passive-effect-unmount-start-'.concat(
                  componentName
                )
              );
            }
          }
          function markComponentPassiveEffectUnmountStopped() {
            if (!isProfiling) {
              return;
            }
            if (currentReactComponentMeasure) {
              if (currentTimelineData) {
                currentTimelineData.componentMeasures.push(
                  currentReactComponentMeasure
                );
              }
              currentReactComponentMeasure.duration =
                getRelativeTime() - currentReactComponentMeasure.timestamp;
              currentReactComponentMeasure = null;
            }
            if (supportsUserTimingV3) {
              markAndClear('--component-passive-effect-unmount-stop');
            }
          }
          function markComponentErrored(fiber, thrownValue, lanes) {
            if (!isProfiling) {
              return;
            }
            var componentName = getDisplayNameForFiber(fiber) || 'Unknown';
            var phase = fiber.alternate === null ? 'mount' : 'update';
            var message = '';
            if (
              thrownValue !== null &&
              profilingHooks_typeof(thrownValue) === 'object' &&
              typeof thrownValue.message === 'string'
            ) {
              message = thrownValue.message;
            } else if (typeof thrownValue === 'string') {
              message = thrownValue;
            }
            if (currentTimelineData) {
              currentTimelineData.thrownErrors.push({
                componentName,
                message,
                phase,
                timestamp: getRelativeTime(),
                type: 'thrown-error',
              });
            }
            if (supportsUserTimingV3) {
              markAndClear(
                '--error-'
                  .concat(componentName, '-')
                  .concat(phase, '-')
                  .concat(message)
              );
            }
          }
          var PossiblyWeakMap2 = typeof WeakMap === 'function' ? WeakMap : Map;
          var wakeableIDs = new PossiblyWeakMap2();
          var wakeableID = 0;
          function getWakeableID(wakeable) {
            if (!wakeableIDs.has(wakeable)) {
              wakeableIDs.set(wakeable, wakeableID++);
            }
            return wakeableIDs.get(wakeable);
          }
          function markComponentSuspended(fiber, wakeable, lanes) {
            if (!isProfiling) {
              return;
            }
            var eventType = wakeableIDs.has(wakeable) ? 'resuspend' : 'suspend';
            var id = getWakeableID(wakeable);
            var componentName = getDisplayNameForFiber(fiber) || 'Unknown';
            var phase = fiber.alternate === null ? 'mount' : 'update';
            var displayName = wakeable.displayName || '';
            var suspenseEvent = null;
            suspenseEvent = {
              componentName,
              depth: 0,
              duration: 0,
              id: ''.concat(id),
              phase,
              promiseName: displayName,
              resolution: 'unresolved',
              timestamp: getRelativeTime(),
              type: 'suspense',
              warning: null,
            };
            if (currentTimelineData) {
              currentTimelineData.suspenseEvents.push(suspenseEvent);
            }
            if (supportsUserTimingV3) {
              markAndClear(
                '--suspense-'
                  .concat(eventType, '-')
                  .concat(id, '-')
                  .concat(componentName, '-')
                  .concat(phase, '-')
                  .concat(lanes, '-')
                  .concat(displayName)
              );
              wakeable.then(
                function () {
                  if (suspenseEvent) {
                    suspenseEvent.duration =
                      getRelativeTime() - suspenseEvent.timestamp;
                    suspenseEvent.resolution = 'resolved';
                  }
                  if (supportsUserTimingV3) {
                    markAndClear(
                      '--suspense-resolved-'
                        .concat(id, '-')
                        .concat(componentName)
                    );
                  }
                },
                function () {
                  if (suspenseEvent) {
                    suspenseEvent.duration =
                      getRelativeTime() - suspenseEvent.timestamp;
                    suspenseEvent.resolution = 'rejected';
                  }
                  if (supportsUserTimingV3) {
                    markAndClear(
                      '--suspense-rejected-'
                        .concat(id, '-')
                        .concat(componentName)
                    );
                  }
                }
              );
            }
          }
          function markLayoutEffectsStarted(lanes) {
            if (!isProfiling) {
              return;
            }
            recordReactMeasureStarted('layout-effects', lanes);
            if (supportsUserTimingV3) {
              markAndClear('--layout-effects-start-'.concat(lanes));
            }
          }
          function markLayoutEffectsStopped() {
            if (!isProfiling) {
              return;
            }
            recordReactMeasureCompleted('layout-effects');
            if (supportsUserTimingV3) {
              markAndClear('--layout-effects-stop');
            }
          }
          function markPassiveEffectsStarted(lanes) {
            if (!isProfiling) {
              return;
            }
            recordReactMeasureStarted('passive-effects', lanes);
            if (supportsUserTimingV3) {
              markAndClear('--passive-effects-start-'.concat(lanes));
            }
          }
          function markPassiveEffectsStopped() {
            if (!isProfiling) {
              return;
            }
            recordReactMeasureCompleted('passive-effects');
            if (supportsUserTimingV3) {
              markAndClear('--passive-effects-stop');
            }
          }
          function markRenderStarted(lanes) {
            if (!isProfiling) {
              return;
            }
            if (nextRenderShouldStartNewBatch) {
              nextRenderShouldStartNewBatch = false;
              currentBatchUID++;
            }
            if (
              currentReactMeasuresStack.length === 0 ||
              currentReactMeasuresStack[currentReactMeasuresStack.length - 1]
                .type !== 'render-idle'
            ) {
              recordReactMeasureStarted('render-idle', lanes);
            }
            recordReactMeasureStarted('render', lanes);
            if (supportsUserTimingV3) {
              markAndClear('--render-start-'.concat(lanes));
            }
          }
          function markRenderYielded() {
            if (!isProfiling) {
              return;
            }
            recordReactMeasureCompleted('render');
            if (supportsUserTimingV3) {
              markAndClear('--render-yield');
            }
          }
          function markRenderStopped() {
            if (!isProfiling) {
              return;
            }
            recordReactMeasureCompleted('render');
            if (supportsUserTimingV3) {
              markAndClear('--render-stop');
            }
          }
          function markRenderScheduled(lane) {
            if (!isProfiling) {
              return;
            }
            if (currentTimelineData) {
              currentTimelineData.schedulingEvents.push({
                lanes: laneToLanesArray(lane),
                timestamp: getRelativeTime(),
                type: 'schedule-render',
                warning: null,
              });
            }
            if (supportsUserTimingV3) {
              markAndClear('--schedule-render-'.concat(lane));
            }
          }
          function markForceUpdateScheduled(fiber, lane) {
            if (!isProfiling) {
              return;
            }
            var componentName = getDisplayNameForFiber(fiber) || 'Unknown';
            if (currentTimelineData) {
              currentTimelineData.schedulingEvents.push({
                componentName,
                lanes: laneToLanesArray(lane),
                timestamp: getRelativeTime(),
                type: 'schedule-force-update',
                warning: null,
              });
            }
            if (supportsUserTimingV3) {
              markAndClear(
                '--schedule-forced-update-'
                  .concat(lane, '-')
                  .concat(componentName)
              );
            }
          }
          function getParentFibers(fiber) {
            var parents = [];
            var parent = fiber;
            while (parent !== null) {
              parents.push(parent);
              parent = parent.return;
            }
            return parents;
          }
          function markStateUpdateScheduled(fiber, lane) {
            if (!isProfiling) {
              return;
            }
            var componentName = getDisplayNameForFiber(fiber) || 'Unknown';
            if (currentTimelineData) {
              var event = {
                componentName,
                lanes: laneToLanesArray(lane),
                timestamp: getRelativeTime(),
                type: 'schedule-state-update',
                warning: null,
              };
              currentFiberStacks.set(event, getParentFibers(fiber));
              currentTimelineData.schedulingEvents.push(event);
            }
            if (supportsUserTimingV3) {
              markAndClear(
                '--schedule-state-update-'
                  .concat(lane, '-')
                  .concat(componentName)
              );
            }
          }
          function toggleProfilingStatus(value) {
            var recordTimeline =
              arguments.length > 1 && arguments[1] !== undefined
                ? arguments[1]
                : false;
            if (isProfiling !== value) {
              isProfiling = value;
              if (isProfiling) {
                var internalModuleSourceToRanges = new Map();
                if (supportsUserTimingV3) {
                  var ranges = getInternalModuleRanges();
                  if (ranges) {
                    for (var i = 0; i < ranges.length; i++) {
                      var range = ranges[i];
                      if (shared_isArray(range) && range.length === 2) {
                        var _ranges$i2 = profilingHooks_slicedToArray(
                            ranges[i],
                            2
                          ),
                          startStackFrame = _ranges$i2[0],
                          stopStackFrame = _ranges$i2[1];
                        markAndClear(
                          '--react-internal-module-start-'.concat(
                            startStackFrame
                          )
                        );
                        markAndClear(
                          '--react-internal-module-stop-'.concat(stopStackFrame)
                        );
                      }
                    }
                  }
                }
                var laneToReactMeasureMap = new Map();
                var lane = 1;
                for (var index = 0; index < REACT_TOTAL_NUM_LANES; index++) {
                  laneToReactMeasureMap.set(lane, []);
                  lane *= 2;
                }
                currentBatchUID = 0;
                currentReactComponentMeasure = null;
                currentReactMeasuresStack = [];
                currentFiberStacks = new Map();
                if (recordTimeline) {
                  currentTimelineData = {
                    internalModuleSourceToRanges,
                    laneToLabelMap: laneToLabelMap || new Map(),
                    reactVersion,
                    componentMeasures: [],
                    schedulingEvents: [],
                    suspenseEvents: [],
                    thrownErrors: [],
                    batchUIDToMeasuresMap: new Map(),
                    duration: 0,
                    laneToReactMeasureMap,
                    startTime: 0,
                    flamechart: [],
                    nativeEvents: [],
                    networkMeasures: [],
                    otherUserTimingMarks: [],
                    snapshots: [],
                    snapshotHeight: 0,
                  };
                }
                nextRenderShouldStartNewBatch = true;
              } else {
                if (currentTimelineData !== null) {
                  currentTimelineData.schedulingEvents.forEach(
                    function (event) {
                      if (event.type === 'schedule-state-update') {
                        var fiberStack = currentFiberStacks.get(event);
                        if (fiberStack && currentDispatcherRef != null) {
                          event.componentStack = fiberStack.reduce(function (
                            trace,
                            fiber
                          ) {
                            return (
                              trace +
                              describeFiber(
                                workTagMap,
                                fiber,
                                currentDispatcherRef
                              )
                            );
                          }, '');
                        }
                      }
                    }
                  );
                }
                currentFiberStacks.clear();
              }
            }
          }
          return {
            getTimelineData,
            profilingHooks: {
              markCommitStarted,
              markCommitStopped,
              markComponentRenderStarted,
              markComponentRenderStopped,
              markComponentPassiveEffectMountStarted,
              markComponentPassiveEffectMountStopped,
              markComponentPassiveEffectUnmountStarted,
              markComponentPassiveEffectUnmountStopped,
              markComponentLayoutEffectMountStarted,
              markComponentLayoutEffectMountStopped,
              markComponentLayoutEffectUnmountStarted,
              markComponentLayoutEffectUnmountStopped,
              markComponentErrored,
              markComponentSuspended,
              markLayoutEffectsStarted,
              markLayoutEffectsStopped,
              markPassiveEffectsStarted,
              markPassiveEffectsStopped,
              markRenderStarted,
              markRenderYielded,
              markRenderStopped,
              markRenderScheduled,
              markForceUpdateScheduled,
              markStateUpdateScheduled,
            },
            toggleProfilingStatus,
          };
        }
        function _objectWithoutProperties(source, excluded) {
          if (source == null) return {};
          var target = _objectWithoutPropertiesLoose(source, excluded);
          var key, i;
          if (Object.getOwnPropertySymbols) {
            var sourceSymbolKeys = Object.getOwnPropertySymbols(source);
            for (i = 0; i < sourceSymbolKeys.length; i++) {
              key = sourceSymbolKeys[i];
              if (excluded.indexOf(key) >= 0) continue;
              if (!Object.prototype.propertyIsEnumerable.call(source, key))
                continue;
              target[key] = source[key];
            }
          }
          return target;
        }
        function _objectWithoutPropertiesLoose(source, excluded) {
          if (source == null) return {};
          var target = {};
          var sourceKeys = Object.keys(source);
          var key, i;
          for (i = 0; i < sourceKeys.length; i++) {
            key = sourceKeys[i];
            if (excluded.indexOf(key) >= 0) continue;
            target[key] = source[key];
          }
          return target;
        }
        function renderer_ownKeys(object, enumerableOnly) {
          var keys = Object.keys(object);
          if (Object.getOwnPropertySymbols) {
            var symbols = Object.getOwnPropertySymbols(object);
            if (enumerableOnly)
              symbols = symbols.filter(function (sym) {
                return Object.getOwnPropertyDescriptor(object, sym).enumerable;
              });
            keys.push.apply(keys, symbols);
          }
          return keys;
        }
        function renderer_objectSpread(target) {
          for (var i = 1; i < arguments.length; i++) {
            var source = arguments[i] != null ? arguments[i] : {};
            if (i % 2) {
              renderer_ownKeys(Object(source), true).forEach(function (key) {
                renderer_defineProperty(target, key, source[key]);
              });
            } else if (Object.getOwnPropertyDescriptors) {
              Object.defineProperties(
                target,
                Object.getOwnPropertyDescriptors(source)
              );
            } else {
              renderer_ownKeys(Object(source)).forEach(function (key) {
                Object.defineProperty(
                  target,
                  key,
                  Object.getOwnPropertyDescriptor(source, key)
                );
              });
            }
          }
          return target;
        }
        function renderer_defineProperty(obj, key, value) {
          if (key in obj) {
            Object.defineProperty(obj, key, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          } else {
            obj[key] = value;
          }
          return obj;
        }
        function fiber_renderer_toConsumableArray(arr) {
          return (
            fiber_renderer_arrayWithoutHoles(arr) ||
            fiber_renderer_iterableToArray(arr) ||
            fiber_renderer_unsupportedIterableToArray(arr) ||
            fiber_renderer_nonIterableSpread()
          );
        }
        function fiber_renderer_nonIterableSpread() {
          throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function fiber_renderer_iterableToArray(iter) {
          if (typeof Symbol !== 'undefined' && Symbol.iterator in Object(iter))
            return Array.from(iter);
        }
        function fiber_renderer_arrayWithoutHoles(arr) {
          if (Array.isArray(arr)) return fiber_renderer_arrayLikeToArray(arr);
        }
        function renderer_createForOfIteratorHelper(o, allowArrayLike) {
          var it;
          if (typeof Symbol === 'undefined' || o[Symbol.iterator] == null) {
            if (
              Array.isArray(o) ||
              (it = fiber_renderer_unsupportedIterableToArray(o)) ||
              (allowArrayLike && o && typeof o.length === 'number')
            ) {
              if (it) o = it;
              var i = 0;
              var F = function F() {};
              return {
                s: F,
                n: function n() {
                  if (i >= o.length) return { done: true };
                  return { done: false, value: o[i++] };
                },
                e: function e(_e) {
                  throw _e;
                },
                f: F,
              };
            }
            throw new TypeError(`Invalid attempt to iterate non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
          }
          var normalCompletion = true,
            didErr = false,
            err;
          return {
            s: function s() {
              it = o[Symbol.iterator]();
            },
            n: function n() {
              var step = it.next();
              normalCompletion = step.done;
              return step;
            },
            e: function e(_e2) {
              didErr = true;
              err = _e2;
            },
            f: function f() {
              try {
                if (!normalCompletion && it.return != null) it.return();
              } finally {
                if (didErr) throw err;
              }
            },
          };
        }
        function fiber_renderer_unsupportedIterableToArray(o, minLen) {
          if (!o) return;
          if (typeof o === 'string')
            return fiber_renderer_arrayLikeToArray(o, minLen);
          var n = Object.prototype.toString.call(o).slice(8, -1);
          if (n === 'Object' && o.constructor) n = o.constructor.name;
          if (n === 'Map' || n === 'Set') return Array.from(o);
          if (
            n === 'Arguments' ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return fiber_renderer_arrayLikeToArray(o, minLen);
        }
        function fiber_renderer_arrayLikeToArray(arr, len) {
          if (len == null || len > arr.length) len = arr.length;
          for (var i = 0, arr2 = new Array(len); i < len; i++) {
            arr2[i] = arr[i];
          }
          return arr2;
        }
        function renderer_typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            renderer_typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            renderer_typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return renderer_typeof(obj);
        }
        var renderer_toString = Object.prototype.toString;
        function renderer_isError(object) {
          return renderer_toString.call(object) === '[object Error]';
        }
        var FIBER_INSTANCE = 0;
        var VIRTUAL_INSTANCE = 1;
        var FILTERED_FIBER_INSTANCE = 2;
        function createFiberInstance(fiber) {
          return {
            kind: FIBER_INSTANCE,
            id: getUID(),
            parent: null,
            firstChild: null,
            nextSibling: null,
            source: null,
            logCount: 0,
            treeBaseDuration: 0,
            data: fiber,
          };
        }
        function createFilteredFiberInstance(fiber) {
          return {
            kind: FILTERED_FIBER_INSTANCE,
            id: 0,
            parent: null,
            firstChild: null,
            nextSibling: null,
            source: null,
            logCount: 0,
            treeBaseDuration: 0,
            data: fiber,
          };
        }
        function createVirtualInstance(debugEntry) {
          return {
            kind: VIRTUAL_INSTANCE,
            id: getUID(),
            parent: null,
            firstChild: null,
            nextSibling: null,
            source: null,
            logCount: 0,
            treeBaseDuration: 0,
            data: debugEntry,
          };
        }
        function getDispatcherRef(renderer) {
          if (renderer.currentDispatcherRef === undefined) {
            return;
          }
          var injectedRef = renderer.currentDispatcherRef;
          if (
            typeof injectedRef.H === 'undefined' &&
            typeof injectedRef.current !== 'undefined'
          ) {
            return {
              get H() {
                return injectedRef.current;
              },
              set H(value) {
                injectedRef.current = value;
              },
            };
          }
          return injectedRef;
        }
        function getFiberFlags(fiber) {
          return fiber.flags !== undefined ? fiber.flags : fiber.effectTag;
        }
        var renderer_getCurrentTime =
          (typeof performance === 'undefined'
            ? 'undefined'
            : renderer_typeof(performance)) === 'object' &&
          typeof performance.now === 'function'
            ? function () {
                return performance.now();
              }
            : function () {
                return Date.now();
              };
        function getInternalReactConstants(version) {
          var ReactPriorityLevels = {
            ImmediatePriority: 99,
            UserBlockingPriority: 98,
            NormalPriority: 97,
            LowPriority: 96,
            IdlePriority: 95,
            NoPriority: 90,
          };
          if (gt(version, '17.0.2')) {
            ReactPriorityLevels = {
              ImmediatePriority: 1,
              UserBlockingPriority: 2,
              NormalPriority: 3,
              LowPriority: 4,
              IdlePriority: 5,
              NoPriority: 0,
            };
          }
          var StrictModeBits = 0;
          if (gte(version, '18.0.0-alpha')) {
            StrictModeBits = 24;
          } else if (gte(version, '16.9.0')) {
            StrictModeBits = 1;
          } else if (gte(version, '16.3.0')) {
            StrictModeBits = 2;
          }
          var ReactTypeOfWork = null;
          if (gt(version, '17.0.1')) {
            ReactTypeOfWork = {
              CacheComponent: 24,
              ClassComponent: 1,
              ContextConsumer: 9,
              ContextProvider: 10,
              CoroutineComponent: -1,
              CoroutineHandlerPhase: -1,
              DehydratedSuspenseComponent: 18,
              ForwardRef: 11,
              Fragment: 7,
              FunctionComponent: 0,
              HostComponent: 5,
              HostPortal: 4,
              HostRoot: 3,
              HostHoistable: 26,
              HostSingleton: 27,
              HostText: 6,
              IncompleteClassComponent: 17,
              IncompleteFunctionComponent: 28,
              IndeterminateComponent: 2,
              LazyComponent: 16,
              LegacyHiddenComponent: 23,
              MemoComponent: 14,
              Mode: 8,
              OffscreenComponent: 22,
              Profiler: 12,
              ScopeComponent: 21,
              SimpleMemoComponent: 15,
              SuspenseComponent: 13,
              SuspenseListComponent: 19,
              TracingMarkerComponent: 25,
              YieldComponent: -1,
              Throw: 29,
              ViewTransitionComponent: 30,
              ActivityComponent: 31,
            };
          } else if (gte(version, '17.0.0-alpha')) {
            ReactTypeOfWork = {
              CacheComponent: -1,
              ClassComponent: 1,
              ContextConsumer: 9,
              ContextProvider: 10,
              CoroutineComponent: -1,
              CoroutineHandlerPhase: -1,
              DehydratedSuspenseComponent: 18,
              ForwardRef: 11,
              Fragment: 7,
              FunctionComponent: 0,
              HostComponent: 5,
              HostPortal: 4,
              HostRoot: 3,
              HostHoistable: -1,
              HostSingleton: -1,
              HostText: 6,
              IncompleteClassComponent: 17,
              IncompleteFunctionComponent: -1,
              IndeterminateComponent: 2,
              LazyComponent: 16,
              LegacyHiddenComponent: 24,
              MemoComponent: 14,
              Mode: 8,
              OffscreenComponent: 23,
              Profiler: 12,
              ScopeComponent: 21,
              SimpleMemoComponent: 15,
              SuspenseComponent: 13,
              SuspenseListComponent: 19,
              TracingMarkerComponent: -1,
              YieldComponent: -1,
              Throw: -1,
              ViewTransitionComponent: -1,
              ActivityComponent: -1,
            };
          } else if (gte(version, '16.6.0-beta.0')) {
            ReactTypeOfWork = {
              CacheComponent: -1,
              ClassComponent: 1,
              ContextConsumer: 9,
              ContextProvider: 10,
              CoroutineComponent: -1,
              CoroutineHandlerPhase: -1,
              DehydratedSuspenseComponent: 18,
              ForwardRef: 11,
              Fragment: 7,
              FunctionComponent: 0,
              HostComponent: 5,
              HostPortal: 4,
              HostRoot: 3,
              HostHoistable: -1,
              HostSingleton: -1,
              HostText: 6,
              IncompleteClassComponent: 17,
              IncompleteFunctionComponent: -1,
              IndeterminateComponent: 2,
              LazyComponent: 16,
              LegacyHiddenComponent: -1,
              MemoComponent: 14,
              Mode: 8,
              OffscreenComponent: -1,
              Profiler: 12,
              ScopeComponent: -1,
              SimpleMemoComponent: 15,
              SuspenseComponent: 13,
              SuspenseListComponent: 19,
              TracingMarkerComponent: -1,
              YieldComponent: -1,
              Throw: -1,
              ViewTransitionComponent: -1,
              ActivityComponent: -1,
            };
          } else if (gte(version, '16.4.3-alpha')) {
            ReactTypeOfWork = {
              CacheComponent: -1,
              ClassComponent: 2,
              ContextConsumer: 11,
              ContextProvider: 12,
              CoroutineComponent: -1,
              CoroutineHandlerPhase: -1,
              DehydratedSuspenseComponent: -1,
              ForwardRef: 13,
              Fragment: 9,
              FunctionComponent: 0,
              HostComponent: 7,
              HostPortal: 6,
              HostRoot: 5,
              HostHoistable: -1,
              HostSingleton: -1,
              HostText: 8,
              IncompleteClassComponent: -1,
              IncompleteFunctionComponent: -1,
              IndeterminateComponent: 4,
              LazyComponent: -1,
              LegacyHiddenComponent: -1,
              MemoComponent: -1,
              Mode: 10,
              OffscreenComponent: -1,
              Profiler: 15,
              ScopeComponent: -1,
              SimpleMemoComponent: -1,
              SuspenseComponent: 16,
              SuspenseListComponent: -1,
              TracingMarkerComponent: -1,
              YieldComponent: -1,
              Throw: -1,
              ViewTransitionComponent: -1,
              ActivityComponent: -1,
            };
          } else {
            ReactTypeOfWork = {
              CacheComponent: -1,
              ClassComponent: 2,
              ContextConsumer: 12,
              ContextProvider: 13,
              CoroutineComponent: 7,
              CoroutineHandlerPhase: 8,
              DehydratedSuspenseComponent: -1,
              ForwardRef: 14,
              Fragment: 10,
              FunctionComponent: 1,
              HostComponent: 5,
              HostPortal: 4,
              HostRoot: 3,
              HostHoistable: -1,
              HostSingleton: -1,
              HostText: 6,
              IncompleteClassComponent: -1,
              IncompleteFunctionComponent: -1,
              IndeterminateComponent: 0,
              LazyComponent: -1,
              LegacyHiddenComponent: -1,
              MemoComponent: -1,
              Mode: 11,
              OffscreenComponent: -1,
              Profiler: 15,
              ScopeComponent: -1,
              SimpleMemoComponent: -1,
              SuspenseComponent: 16,
              SuspenseListComponent: -1,
              TracingMarkerComponent: -1,
              YieldComponent: 9,
              Throw: -1,
              ViewTransitionComponent: -1,
              ActivityComponent: -1,
            };
          }
          function getTypeSymbol(type) {
            var symbolOrNumber =
              renderer_typeof(type) === 'object' && type !== null
                ? type.$$typeof
                : type;
            return renderer_typeof(symbolOrNumber) === 'symbol'
              ? symbolOrNumber.toString()
              : symbolOrNumber;
          }
          var _ReactTypeOfWork = ReactTypeOfWork,
            CacheComponent = _ReactTypeOfWork.CacheComponent,
            ClassComponent = _ReactTypeOfWork.ClassComponent,
            IncompleteClassComponent =
              _ReactTypeOfWork.IncompleteClassComponent,
            IncompleteFunctionComponent =
              _ReactTypeOfWork.IncompleteFunctionComponent,
            FunctionComponent = _ReactTypeOfWork.FunctionComponent,
            IndeterminateComponent = _ReactTypeOfWork.IndeterminateComponent,
            ForwardRef = _ReactTypeOfWork.ForwardRef,
            HostRoot = _ReactTypeOfWork.HostRoot,
            HostHoistable = _ReactTypeOfWork.HostHoistable,
            HostSingleton = _ReactTypeOfWork.HostSingleton,
            HostComponent = _ReactTypeOfWork.HostComponent,
            HostPortal = _ReactTypeOfWork.HostPortal,
            HostText = _ReactTypeOfWork.HostText,
            Fragment = _ReactTypeOfWork.Fragment,
            LazyComponent = _ReactTypeOfWork.LazyComponent,
            LegacyHiddenComponent = _ReactTypeOfWork.LegacyHiddenComponent,
            MemoComponent = _ReactTypeOfWork.MemoComponent,
            OffscreenComponent = _ReactTypeOfWork.OffscreenComponent,
            Profiler = _ReactTypeOfWork.Profiler,
            ScopeComponent = _ReactTypeOfWork.ScopeComponent,
            SimpleMemoComponent = _ReactTypeOfWork.SimpleMemoComponent,
            SuspenseComponent = _ReactTypeOfWork.SuspenseComponent,
            SuspenseListComponent = _ReactTypeOfWork.SuspenseListComponent,
            TracingMarkerComponent = _ReactTypeOfWork.TracingMarkerComponent,
            Throw = _ReactTypeOfWork.Throw,
            ViewTransitionComponent = _ReactTypeOfWork.ViewTransitionComponent,
            ActivityComponent = _ReactTypeOfWork.ActivityComponent;
          function resolveFiberType(type) {
            var typeSymbol = getTypeSymbol(type);
            switch (typeSymbol) {
              case MEMO_NUMBER:
              case MEMO_SYMBOL_STRING:
                return resolveFiberType(type.type);
              case FORWARD_REF_NUMBER:
              case FORWARD_REF_SYMBOL_STRING:
                return type.render;
              default:
                return type;
            }
          }
          function getDisplayNameForFiber(fiber) {
            var _fiber$updateQueue,
              _fiber$memoizedState,
              _fiber$memoizedState$,
              _fiber$memoizedState2,
              _fiber$memoizedState3;
            var shouldSkipForgetCheck =
              arguments.length > 1 && arguments[1] !== undefined
                ? arguments[1]
                : false;
            var { elementType, type, tag } = fiber;
            var resolvedType = type;
            if (renderer_typeof(type) === 'object' && type !== null) {
              resolvedType = resolveFiberType(type);
            }
            var resolvedContext = null;
            if (
              !shouldSkipForgetCheck &&
              (((_fiber$updateQueue = fiber.updateQueue) === null ||
              _fiber$updateQueue === undefined
                ? undefined
                : _fiber$updateQueue.memoCache) != null ||
                (Array.isArray(
                  (_fiber$memoizedState = fiber.memoizedState) === null ||
                    _fiber$memoizedState === undefined
                    ? undefined
                    : _fiber$memoizedState.memoizedState
                ) &&
                  ((_fiber$memoizedState$ =
                    fiber.memoizedState.memoizedState[0]) === null ||
                  _fiber$memoizedState$ === undefined
                    ? undefined
                    : _fiber$memoizedState$[
                        ReactSymbols_REACT_MEMO_CACHE_SENTINEL
                      ])) ||
                ((_fiber$memoizedState2 = fiber.memoizedState) === null ||
                _fiber$memoizedState2 === undefined
                  ? undefined
                  : (_fiber$memoizedState3 =
                        _fiber$memoizedState2.memoizedState) === null ||
                      _fiber$memoizedState3 === undefined
                    ? undefined
                    : _fiber$memoizedState3[
                        ReactSymbols_REACT_MEMO_CACHE_SENTINEL
                      ]))
            ) {
              var displayNameWithoutForgetWrapper = getDisplayNameForFiber(
                fiber,
                true
              );
              if (displayNameWithoutForgetWrapper == null) {
                return null;
              }
              return 'Forget('.concat(displayNameWithoutForgetWrapper, ')');
            }
            switch (tag) {
              case ActivityComponent:
                return 'Activity';
              case CacheComponent:
                return 'Cache';
              case ClassComponent:
              case IncompleteClassComponent:
              case IncompleteFunctionComponent:
              case FunctionComponent:
              case IndeterminateComponent:
                return getDisplayName(resolvedType);
              case ForwardRef:
                return getWrappedDisplayName(
                  elementType,
                  resolvedType,
                  'ForwardRef',
                  'Anonymous'
                );
              case HostRoot:
                var fiberRoot = fiber.stateNode;
                if (fiberRoot != null && fiberRoot._debugRootType !== null) {
                  return fiberRoot._debugRootType;
                }
                return null;
              case HostComponent:
              case HostSingleton:
              case HostHoistable:
                return type;
              case HostPortal:
              case HostText:
                return null;
              case Fragment:
                return 'Fragment';
              case LazyComponent:
                return 'Lazy';
              case MemoComponent:
              case SimpleMemoComponent:
                return getWrappedDisplayName(
                  elementType,
                  resolvedType,
                  'Memo',
                  'Anonymous'
                );
              case SuspenseComponent:
                return 'Suspense';
              case LegacyHiddenComponent:
                return 'LegacyHidden';
              case OffscreenComponent:
                return 'Offscreen';
              case ScopeComponent:
                return 'Scope';
              case SuspenseListComponent:
                return 'SuspenseList';
              case Profiler:
                return 'Profiler';
              case TracingMarkerComponent:
                return 'TracingMarker';
              case ViewTransitionComponent:
                return 'ViewTransition';
              case Throw:
                return 'Error';
              default:
                var typeSymbol = getTypeSymbol(type);
                switch (typeSymbol) {
                  case CONCURRENT_MODE_NUMBER:
                  case CONCURRENT_MODE_SYMBOL_STRING:
                  case DEPRECATED_ASYNC_MODE_SYMBOL_STRING:
                    return null;
                  case PROVIDER_NUMBER:
                  case PROVIDER_SYMBOL_STRING:
                    resolvedContext = fiber.type._context || fiber.type.context;
                    return ''.concat(
                      resolvedContext.displayName || 'Context',
                      '.Provider'
                    );
                  case CONTEXT_NUMBER:
                  case CONTEXT_SYMBOL_STRING:
                  case SERVER_CONTEXT_SYMBOL_STRING:
                    if (
                      fiber.type._context === undefined &&
                      fiber.type.Provider === fiber.type
                    ) {
                      resolvedContext = fiber.type;
                      return ''.concat(
                        resolvedContext.displayName || 'Context',
                        '.Provider'
                      );
                    }
                    resolvedContext = fiber.type._context || fiber.type;
                    return ''.concat(
                      resolvedContext.displayName || 'Context',
                      '.Consumer'
                    );
                  case CONSUMER_SYMBOL_STRING:
                    resolvedContext = fiber.type._context;
                    return ''.concat(
                      resolvedContext.displayName || 'Context',
                      '.Consumer'
                    );
                  case STRICT_MODE_NUMBER:
                  case STRICT_MODE_SYMBOL_STRING:
                    return null;
                  case PROFILER_NUMBER:
                  case PROFILER_SYMBOL_STRING:
                    return 'Profiler('.concat(fiber.memoizedProps.id, ')');
                  case SCOPE_NUMBER:
                  case SCOPE_SYMBOL_STRING:
                    return 'Scope';
                  default:
                    return null;
                }
            }
          }
          return {
            getDisplayNameForFiber,
            getTypeSymbol,
            ReactPriorityLevels,
            ReactTypeOfWork,
            StrictModeBits,
          };
        }
        var knownEnvironmentNames = new Set();
        var rootToFiberInstanceMap = new Map();
        var idToDevToolsInstanceMap = new Map();
        var publicInstanceToDevToolsInstanceMap = new Map();
        var hostResourceToDevToolsInstanceMap = new Map();
        function getPublicInstance(instance) {
          if (renderer_typeof(instance) === 'object' && instance !== null) {
            if (
              renderer_typeof(instance.canonical) === 'object' &&
              instance.canonical !== null
            ) {
              if (
                renderer_typeof(instance.canonical.publicInstance) ===
                  'object' &&
                instance.canonical.publicInstance !== null
              ) {
                return instance.canonical.publicInstance;
              }
            }
            if (typeof instance._nativeTag === 'number') {
              return instance._nativeTag;
            }
          }
          return instance;
        }
        function getNativeTag(instance) {
          if (renderer_typeof(instance) !== 'object' || instance === null) {
            return null;
          }
          if (
            instance.canonical != null &&
            typeof instance.canonical.nativeTag === 'number'
          ) {
            return instance.canonical.nativeTag;
          }
          if (typeof instance._nativeTag === 'number') {
            return instance._nativeTag;
          }
          return null;
        }
        function aquireHostInstance(nearestInstance, hostInstance) {
          var publicInstance = getPublicInstance(hostInstance);
          publicInstanceToDevToolsInstanceMap.set(
            publicInstance,
            nearestInstance
          );
        }
        function releaseHostInstance(nearestInstance, hostInstance) {
          var publicInstance = getPublicInstance(hostInstance);
          if (
            publicInstanceToDevToolsInstanceMap.get(publicInstance) ===
            nearestInstance
          ) {
            publicInstanceToDevToolsInstanceMap.delete(publicInstance);
          }
        }
        function aquireHostResource(nearestInstance, resource) {
          var hostInstance = resource && resource.instance;
          if (hostInstance) {
            var publicInstance = getPublicInstance(hostInstance);
            var resourceInstances =
              hostResourceToDevToolsInstanceMap.get(publicInstance);
            if (resourceInstances === undefined) {
              resourceInstances = new Set();
              hostResourceToDevToolsInstanceMap.set(
                publicInstance,
                resourceInstances
              );
              publicInstanceToDevToolsInstanceMap.set(
                publicInstance,
                nearestInstance
              );
            }
            resourceInstances.add(nearestInstance);
          }
        }
        function releaseHostResource(nearestInstance, resource) {
          var hostInstance = resource && resource.instance;
          if (hostInstance) {
            var publicInstance = getPublicInstance(hostInstance);
            var resourceInstances =
              hostResourceToDevToolsInstanceMap.get(publicInstance);
            if (resourceInstances !== undefined) {
              resourceInstances.delete(nearestInstance);
              if (resourceInstances.size === 0) {
                hostResourceToDevToolsInstanceMap.delete(publicInstance);
                publicInstanceToDevToolsInstanceMap.delete(publicInstance);
              } else if (
                publicInstanceToDevToolsInstanceMap.get(publicInstance) ===
                nearestInstance
              ) {
                var _iterator =
                    renderer_createForOfIteratorHelper(resourceInstances),
                  _step;
                try {
                  for (_iterator.s(); !(_step = _iterator.n()).done; ) {
                    var firstInstance = _step.value;
                    publicInstanceToDevToolsInstanceMap.set(
                      firstInstance,
                      nearestInstance
                    );
                    break;
                  }
                } catch (err) {
                  _iterator.e(err);
                } finally {
                  _iterator.f();
                }
              }
            }
          }
        }
        function renderer_attach(
          hook,
          rendererID,
          renderer,
          global2,
          shouldStartProfilingNow,
          profilingSettings
        ) {
          var version = renderer.reconcilerVersion || renderer.version;
          var _getInternalReactCons = getInternalReactConstants(version),
            getDisplayNameForFiber =
              _getInternalReactCons.getDisplayNameForFiber,
            getTypeSymbol = _getInternalReactCons.getTypeSymbol,
            ReactPriorityLevels = _getInternalReactCons.ReactPriorityLevels,
            ReactTypeOfWork = _getInternalReactCons.ReactTypeOfWork,
            StrictModeBits = _getInternalReactCons.StrictModeBits;
          var {
            ActivityComponent,
            CacheComponent,
            ClassComponent,
            ContextConsumer,
            DehydratedSuspenseComponent,
            ForwardRef,
            Fragment,
            FunctionComponent,
            HostRoot,
            HostHoistable,
            HostSingleton,
            HostPortal,
            HostComponent,
            HostText,
            IncompleteClassComponent,
            IncompleteFunctionComponent,
            IndeterminateComponent,
            LegacyHiddenComponent,
            MemoComponent,
            OffscreenComponent,
            SimpleMemoComponent,
            SuspenseComponent,
            SuspenseListComponent,
            TracingMarkerComponent,
            Throw,
            ViewTransitionComponent,
          } = ReactTypeOfWork;
          var {
            ImmediatePriority,
            UserBlockingPriority,
            NormalPriority,
            LowPriority,
            IdlePriority,
            NoPriority,
          } = ReactPriorityLevels;
          var {
            getLaneLabelMap,
            injectProfilingHooks,
            overrideHookState,
            overrideHookStateDeletePath,
            overrideHookStateRenamePath,
            overrideProps,
            overridePropsDeletePath,
            overridePropsRenamePath,
            scheduleRefresh,
            setErrorHandler,
            setSuspenseHandler,
            scheduleUpdate,
            getCurrentFiber,
          } = renderer;
          var supportsTogglingError =
            typeof setErrorHandler === 'function' &&
            typeof scheduleUpdate === 'function';
          var supportsTogglingSuspense =
            typeof setSuspenseHandler === 'function' &&
            typeof scheduleUpdate === 'function';
          if (typeof scheduleRefresh === 'function') {
            renderer.scheduleRefresh = function () {
              try {
                hook.emit('fastRefreshScheduled');
              } finally {
                return scheduleRefresh.apply(undefined, arguments);
              }
            };
          }
          var getTimelineData = null;
          var toggleProfilingStatus = null;
          if (typeof injectProfilingHooks === 'function') {
            var response = createProfilingHooks({
              getDisplayNameForFiber,
              getIsProfiling: function getIsProfiling() {
                return isProfiling;
              },
              getLaneLabelMap,
              currentDispatcherRef: getDispatcherRef(renderer),
              workTagMap: ReactTypeOfWork,
              reactVersion: version,
            });
            injectProfilingHooks(response.profilingHooks);
            getTimelineData = response.getTimelineData;
            toggleProfilingStatus = response.toggleProfilingStatus;
          }
          var fiberToComponentLogsMap = new WeakMap();
          var needsToFlushComponentLogs = false;
          function bruteForceFlushErrorsAndWarnings() {
            var hasChanges = false;
            var _iterator2 = renderer_createForOfIteratorHelper(
                idToDevToolsInstanceMap.values()
              ),
              _step2;
            try {
              for (_iterator2.s(); !(_step2 = _iterator2.n()).done; ) {
                var devtoolsInstance = _step2.value;
                if (devtoolsInstance.kind === FIBER_INSTANCE) {
                  var _fiber = devtoolsInstance.data;
                  var componentLogsEntry = fiberToComponentLogsMap.get(_fiber);
                  var changed = recordConsoleLogs(
                    devtoolsInstance,
                    componentLogsEntry
                  );
                  if (changed) {
                    hasChanges = true;
                    updateMostRecentlyInspectedElementIfNecessary(
                      devtoolsInstance.id
                    );
                  }
                } else {
                }
              }
            } catch (err) {
              _iterator2.e(err);
            } finally {
              _iterator2.f();
            }
            if (hasChanges) {
              flushPendingEvents();
            }
          }
          function clearErrorsAndWarnings() {
            var _iterator3 = renderer_createForOfIteratorHelper(
                idToDevToolsInstanceMap.values()
              ),
              _step3;
            try {
              for (_iterator3.s(); !(_step3 = _iterator3.n()).done; ) {
                var devtoolsInstance = _step3.value;
                if (devtoolsInstance.kind === FIBER_INSTANCE) {
                  var _fiber2 = devtoolsInstance.data;
                  fiberToComponentLogsMap.delete(_fiber2);
                  if (_fiber2.alternate) {
                    fiberToComponentLogsMap.delete(_fiber2.alternate);
                  }
                } else {
                  componentInfoToComponentLogsMap['delete'](
                    devtoolsInstance.data
                  );
                }
                var changed = recordConsoleLogs(devtoolsInstance, undefined);
                if (changed) {
                  updateMostRecentlyInspectedElementIfNecessary(
                    devtoolsInstance.id
                  );
                }
              }
            } catch (err) {
              _iterator3.e(err);
            } finally {
              _iterator3.f();
            }
            flushPendingEvents();
          }
          function clearConsoleLogsHelper(instanceID, type) {
            var devtoolsInstance = idToDevToolsInstanceMap.get(instanceID);
            if (devtoolsInstance !== undefined) {
              var componentLogsEntry;
              if (devtoolsInstance.kind === FIBER_INSTANCE) {
                var _fiber3 = devtoolsInstance.data;
                componentLogsEntry = fiberToComponentLogsMap.get(_fiber3);
                if (
                  componentLogsEntry === undefined &&
                  _fiber3.alternate !== null
                ) {
                  componentLogsEntry = fiberToComponentLogsMap.get(
                    _fiber3.alternate
                  );
                }
              } else {
                var componentInfo = devtoolsInstance.data;
                componentLogsEntry =
                  componentInfoToComponentLogsMap.get(componentInfo);
              }
              if (componentLogsEntry !== undefined) {
                if (type === 'error') {
                  componentLogsEntry.errors.clear();
                  componentLogsEntry.errorsCount = 0;
                } else {
                  componentLogsEntry.warnings.clear();
                  componentLogsEntry.warningsCount = 0;
                }
                var changed = recordConsoleLogs(
                  devtoolsInstance,
                  componentLogsEntry
                );
                if (changed) {
                  flushPendingEvents();
                  updateMostRecentlyInspectedElementIfNecessary(
                    devtoolsInstance.id
                  );
                }
              }
            }
          }
          function clearErrorsForElementID(instanceID) {
            clearConsoleLogsHelper(instanceID, 'error');
          }
          function clearWarningsForElementID(instanceID) {
            clearConsoleLogsHelper(instanceID, 'warn');
          }
          function updateMostRecentlyInspectedElementIfNecessary(fiberID) {
            if (
              mostRecentlyInspectedElement !== null &&
              mostRecentlyInspectedElement.id === fiberID
            ) {
              hasElementUpdatedSinceLastInspected = true;
            }
          }
          function getComponentStack(topFrame) {
            if (getCurrentFiber == null) {
              return null;
            }
            var current = getCurrentFiber();
            if (current === null) {
              return null;
            }
            if (DevToolsFiberComponentStack_supportsConsoleTasks(current)) {
              return null;
            }
            var dispatcherRef = getDispatcherRef(renderer);
            if (dispatcherRef === undefined) {
              return null;
            }
            var enableOwnerStacks = supportsOwnerStacks(current);
            var componentStack = '';
            if (enableOwnerStacks) {
              var topStackFrames = formatOwnerStack(topFrame);
              if (topStackFrames) {
                componentStack +=
                  `
` + topStackFrames;
              }
              componentStack += getOwnerStackByFiberInDev(
                ReactTypeOfWork,
                current,
                dispatcherRef
              );
            } else {
              componentStack = getStackByFiberInDevAndProd(
                ReactTypeOfWork,
                current,
                dispatcherRef
              );
            }
            return {
              enableOwnerStacks,
              componentStack,
            };
          }
          function onErrorOrWarning(type, args) {
            if (getCurrentFiber == null) {
              return;
            }
            var fiber = getCurrentFiber();
            if (fiber === null) {
              return;
            }
            if (type === 'error') {
              if (
                forceErrorForFibers.get(fiber) === true ||
                (fiber.alternate !== null &&
                  forceErrorForFibers.get(fiber.alternate) === true)
              ) {
                return;
              }
            }
            var message = formatConsoleArgumentsToSingleString.apply(
              undefined,
              fiber_renderer_toConsumableArray(args)
            );
            var componentLogsEntry = fiberToComponentLogsMap.get(fiber);
            if (componentLogsEntry === undefined && fiber.alternate !== null) {
              componentLogsEntry = fiberToComponentLogsMap.get(fiber.alternate);
              if (componentLogsEntry !== undefined) {
                fiberToComponentLogsMap.set(fiber, componentLogsEntry);
              }
            }
            if (componentLogsEntry === undefined) {
              componentLogsEntry = {
                errors: new Map(),
                errorsCount: 0,
                warnings: new Map(),
                warningsCount: 0,
              };
              fiberToComponentLogsMap.set(fiber, componentLogsEntry);
            }
            var messageMap =
              type === 'error'
                ? componentLogsEntry.errors
                : componentLogsEntry.warnings;
            var count = messageMap.get(message) || 0;
            messageMap.set(message, count + 1);
            if (type === 'error') {
              componentLogsEntry.errorsCount++;
            } else {
              componentLogsEntry.warningsCount++;
            }
            needsToFlushComponentLogs = true;
          }
          function debug2(name, instance, parentInstance) {
            var extraString =
              arguments.length > 3 && arguments[3] !== undefined
                ? arguments[3]
                : '';
            if (__DEBUG__) {
              var displayName =
                instance.kind === VIRTUAL_INSTANCE
                  ? instance.data.name || 'null'
                  : instance.data.tag +
                    ':' +
                    (getDisplayNameForFiber(instance.data) || 'null');
              var maybeID =
                instance.kind === FILTERED_FIBER_INSTANCE
                  ? '<no id>'
                  : instance.id;
              var parentDisplayName =
                parentInstance === null
                  ? ''
                  : parentInstance.kind === VIRTUAL_INSTANCE
                    ? parentInstance.data.name || 'null'
                    : parentInstance.data.tag +
                      ':' +
                      (getDisplayNameForFiber(parentInstance.data) || 'null');
              var maybeParentID =
                parentInstance === null ||
                parentInstance.kind === FILTERED_FIBER_INSTANCE
                  ? '<no id>'
                  : parentInstance.id;
              console.groupCollapsed(
                '[renderer] %c'
                  .concat(name, ' %c')
                  .concat(displayName, ' (')
                  .concat(maybeID, ') %c')
                  .concat(
                    parentInstance
                      ? ''
                          .concat(parentDisplayName, ' (')
                          .concat(maybeParentID, ')')
                      : '',
                    ' %c'
                  )
                  .concat(extraString),
                'color: red; font-weight: bold;',
                'color: blue;',
                'color: purple;',
                'color: black;'
              );
              console.log(
                new Error().stack
                  .split(`
`)
                  .slice(1)
                  .join(`
`)
              );
              console.groupEnd();
            }
          }
          function debugTree(instance) {
            var indent =
              arguments.length > 1 && arguments[1] !== undefined
                ? arguments[1]
                : 0;
            if (__DEBUG__) {
              var name =
                (instance.kind !== VIRTUAL_INSTANCE
                  ? getDisplayNameForFiber(instance.data)
                  : instance.data.name) || '';
              console.log(
                '  '.repeat(indent) +
                  '- ' +
                  (instance.kind === FILTERED_FIBER_INSTANCE
                    ? 0
                    : instance.id) +
                  ' (' +
                  name +
                  ')',
                'parent',
                instance.parent === null
                  ? ' '
                  : instance.parent.kind === FILTERED_FIBER_INSTANCE
                    ? 0
                    : instance.parent.id,
                'next',
                instance.nextSibling === null ? ' ' : instance.nextSibling.id
              );
              var child = instance.firstChild;
              while (child !== null) {
                debugTree(child, indent + 1);
                child = child.nextSibling;
              }
            }
          }
          var hideElementsWithDisplayNames = new Set();
          var hideElementsWithPaths = new Set();
          var hideElementsWithTypes = new Set();
          var hideElementsWithEnvs = new Set();
          var traceUpdatesEnabled = false;
          var traceUpdatesForNodes = new Set();
          function applyComponentFilters(componentFilters) {
            hideElementsWithTypes.clear();
            hideElementsWithDisplayNames.clear();
            hideElementsWithPaths.clear();
            hideElementsWithEnvs.clear();
            componentFilters.forEach(function (componentFilter) {
              if (!componentFilter.isEnabled) {
                return;
              }
              switch (componentFilter.type) {
                case ComponentFilterDisplayName:
                  if (componentFilter.isValid && componentFilter.value !== '') {
                    hideElementsWithDisplayNames.add(
                      new RegExp(componentFilter.value, 'i')
                    );
                  }
                  break;
                case ComponentFilterElementType:
                  hideElementsWithTypes.add(componentFilter.value);
                  break;
                case ComponentFilterLocation:
                  if (componentFilter.isValid && componentFilter.value !== '') {
                    hideElementsWithPaths.add(
                      new RegExp(componentFilter.value, 'i')
                    );
                  }
                  break;
                case ComponentFilterHOC:
                  hideElementsWithDisplayNames.add(new RegExp('\\('));
                  break;
                case ComponentFilterEnvironmentName:
                  hideElementsWithEnvs.add(componentFilter.value);
                  break;
                default:
                  console.warn(
                    'Invalid component filter type "'.concat(
                      componentFilter.type,
                      '"'
                    )
                  );
                  break;
              }
            });
          }
          if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ != null) {
            var componentFiltersWithoutLocationBasedOnes =
              filterOutLocationComponentFilters(
                window.__REACT_DEVTOOLS_COMPONENT_FILTERS__
              );
            applyComponentFilters(componentFiltersWithoutLocationBasedOnes);
          } else {
            applyComponentFilters(getDefaultComponentFilters());
          }
          function updateComponentFilters(componentFilters) {
            if (isProfiling) {
              throw Error('Cannot modify filter preferences while profiling');
            }
            hook.getFiberRoots(rendererID).forEach(function (root) {
              var rootInstance = rootToFiberInstanceMap.get(root);
              if (rootInstance === undefined) {
                throw new Error(
                  'Expected the root instance to already exist when applying filters'
                );
              }
              currentRoot = rootInstance;
              unmountInstanceRecursively(rootInstance);
              rootToFiberInstanceMap.delete(root);
              flushPendingEvents(root);
              currentRoot = null;
            });
            applyComponentFilters(componentFilters);
            rootDisplayNameCounter.clear();
            hook.getFiberRoots(rendererID).forEach(function (root) {
              var current = root.current;
              var newRoot = createFiberInstance(current);
              rootToFiberInstanceMap.set(root, newRoot);
              idToDevToolsInstanceMap.set(newRoot.id, newRoot);
              if (trackedPath !== null) {
                mightBeOnTrackedPath = true;
              }
              currentRoot = newRoot;
              setRootPseudoKey(currentRoot.id, root.current);
              mountFiberRecursively(root.current, false);
              flushPendingEvents(root);
              currentRoot = null;
            });
            flushPendingEvents();
            needsToFlushComponentLogs = false;
          }
          function getEnvironmentNames() {
            return Array.from(knownEnvironmentNames);
          }
          function shouldFilterVirtual(data, secondaryEnv) {
            if (hideElementsWithTypes.has(types_ElementTypeFunction)) {
              return true;
            }
            if (hideElementsWithDisplayNames.size > 0) {
              var displayName = data.name;
              if (displayName != null) {
                var _iterator4 = renderer_createForOfIteratorHelper(
                    hideElementsWithDisplayNames
                  ),
                  _step4;
                try {
                  for (_iterator4.s(); !(_step4 = _iterator4.n()).done; ) {
                    var displayNameRegExp = _step4.value;
                    if (displayNameRegExp.test(displayName)) {
                      return true;
                    }
                  }
                } catch (err) {
                  _iterator4.e(err);
                } finally {
                  _iterator4.f();
                }
              }
            }
            if (
              (data.env == null || hideElementsWithEnvs.has(data.env)) &&
              (secondaryEnv === null || hideElementsWithEnvs.has(secondaryEnv))
            ) {
              return true;
            }
            return false;
          }
          function shouldFilterFiber(fiber) {
            var { tag, type, key } = fiber;
            switch (tag) {
              case DehydratedSuspenseComponent:
                return true;
              case HostPortal:
              case HostText:
              case LegacyHiddenComponent:
              case OffscreenComponent:
              case Throw:
                return true;
              case HostRoot:
                return false;
              case Fragment:
                return key === null;
              default:
                var typeSymbol = getTypeSymbol(type);
                switch (typeSymbol) {
                  case CONCURRENT_MODE_NUMBER:
                  case CONCURRENT_MODE_SYMBOL_STRING:
                  case DEPRECATED_ASYNC_MODE_SYMBOL_STRING:
                  case STRICT_MODE_NUMBER:
                  case STRICT_MODE_SYMBOL_STRING:
                    return true;
                  default:
                    break;
                }
            }
            var elementType = getElementTypeForFiber(fiber);
            if (hideElementsWithTypes.has(elementType)) {
              return true;
            }
            if (hideElementsWithDisplayNames.size > 0) {
              var displayName = getDisplayNameForFiber(fiber);
              if (displayName != null) {
                var _iterator5 = renderer_createForOfIteratorHelper(
                    hideElementsWithDisplayNames
                  ),
                  _step5;
                try {
                  for (_iterator5.s(); !(_step5 = _iterator5.n()).done; ) {
                    var displayNameRegExp = _step5.value;
                    if (displayNameRegExp.test(displayName)) {
                      return true;
                    }
                  }
                } catch (err) {
                  _iterator5.e(err);
                } finally {
                  _iterator5.f();
                }
              }
            }
            if (hideElementsWithEnvs.has('Client')) {
              switch (tag) {
                case ClassComponent:
                case IncompleteClassComponent:
                case IncompleteFunctionComponent:
                case FunctionComponent:
                case IndeterminateComponent:
                case ForwardRef:
                case MemoComponent:
                case SimpleMemoComponent:
                  return true;
              }
            }
            return false;
          }
          function getElementTypeForFiber(fiber) {
            var { type, tag } = fiber;
            switch (tag) {
              case ActivityComponent:
                return ElementTypeActivity;
              case ClassComponent:
              case IncompleteClassComponent:
                return types_ElementTypeClass;
              case IncompleteFunctionComponent:
              case FunctionComponent:
              case IndeterminateComponent:
                return types_ElementTypeFunction;
              case ForwardRef:
                return types_ElementTypeForwardRef;
              case HostRoot:
                return ElementTypeRoot;
              case HostComponent:
              case HostHoistable:
              case HostSingleton:
                return ElementTypeHostComponent;
              case HostPortal:
              case HostText:
              case Fragment:
                return ElementTypeOtherOrUnknown;
              case MemoComponent:
              case SimpleMemoComponent:
                return types_ElementTypeMemo;
              case SuspenseComponent:
                return ElementTypeSuspense;
              case SuspenseListComponent:
                return ElementTypeSuspenseList;
              case TracingMarkerComponent:
                return ElementTypeTracingMarker;
              case ViewTransitionComponent:
                return ElementTypeViewTransition;
              default:
                var typeSymbol = getTypeSymbol(type);
                switch (typeSymbol) {
                  case CONCURRENT_MODE_NUMBER:
                  case CONCURRENT_MODE_SYMBOL_STRING:
                  case DEPRECATED_ASYNC_MODE_SYMBOL_STRING:
                    return ElementTypeOtherOrUnknown;
                  case PROVIDER_NUMBER:
                  case PROVIDER_SYMBOL_STRING:
                    return ElementTypeContext;
                  case CONTEXT_NUMBER:
                  case CONTEXT_SYMBOL_STRING:
                    return ElementTypeContext;
                  case STRICT_MODE_NUMBER:
                  case STRICT_MODE_SYMBOL_STRING:
                    return ElementTypeOtherOrUnknown;
                  case PROFILER_NUMBER:
                  case PROFILER_SYMBOL_STRING:
                    return ElementTypeProfiler;
                  default:
                    return ElementTypeOtherOrUnknown;
                }
            }
          }
          var currentRoot = null;
          function untrackFiber(nearestInstance, fiber) {
            if (forceErrorForFibers.size > 0) {
              forceErrorForFibers.delete(fiber);
              if (fiber.alternate) {
                forceErrorForFibers.delete(fiber.alternate);
              }
              if (forceErrorForFibers.size === 0 && setErrorHandler != null) {
                setErrorHandler(shouldErrorFiberAlwaysNull);
              }
            }
            if (forceFallbackForFibers.size > 0) {
              forceFallbackForFibers.delete(fiber);
              if (fiber.alternate) {
                forceFallbackForFibers.delete(fiber.alternate);
              }
              if (
                forceFallbackForFibers.size === 0 &&
                setSuspenseHandler != null
              ) {
                setSuspenseHandler(shouldSuspendFiberAlwaysFalse);
              }
            }
            if (fiber.tag === HostHoistable) {
              releaseHostResource(nearestInstance, fiber.memoizedState);
            } else if (
              fiber.tag === HostComponent ||
              fiber.tag === HostText ||
              fiber.tag === HostSingleton
            ) {
              releaseHostInstance(nearestInstance, fiber.stateNode);
            }
            for (
              var child = fiber.child;
              child !== null;
              child = child.sibling
            ) {
              if (shouldFilterFiber(child)) {
                untrackFiber(nearestInstance, child);
              }
            }
          }
          function getChangeDescription(prevFiber, nextFiber) {
            switch (nextFiber.tag) {
              case ClassComponent:
                if (prevFiber === null) {
                  return {
                    context: null,
                    didHooksChange: false,
                    isFirstMount: true,
                    props: null,
                    state: null,
                  };
                } else {
                  var data = {
                    context: getContextChanged(prevFiber, nextFiber),
                    didHooksChange: false,
                    isFirstMount: false,
                    props: getChangedKeys(
                      prevFiber.memoizedProps,
                      nextFiber.memoizedProps
                    ),
                    state: getChangedKeys(
                      prevFiber.memoizedState,
                      nextFiber.memoizedState
                    ),
                  };
                  return data;
                }
              case IncompleteFunctionComponent:
              case FunctionComponent:
              case IndeterminateComponent:
              case ForwardRef:
              case MemoComponent:
              case SimpleMemoComponent:
                if (prevFiber === null) {
                  return {
                    context: null,
                    didHooksChange: false,
                    isFirstMount: true,
                    props: null,
                    state: null,
                  };
                } else {
                  var indices = getChangedHooksIndices(
                    prevFiber.memoizedState,
                    nextFiber.memoizedState
                  );
                  var _data = {
                    context: getContextChanged(prevFiber, nextFiber),
                    didHooksChange: indices !== null && indices.length > 0,
                    isFirstMount: false,
                    props: getChangedKeys(
                      prevFiber.memoizedProps,
                      nextFiber.memoizedProps
                    ),
                    state: null,
                    hooks: indices,
                  };
                  return _data;
                }
              default:
                return null;
            }
          }
          function getContextChanged(prevFiber, nextFiber) {
            var prevContext =
              prevFiber.dependencies && prevFiber.dependencies.firstContext;
            var nextContext =
              nextFiber.dependencies && nextFiber.dependencies.firstContext;
            while (prevContext && nextContext) {
              if (prevContext.context !== nextContext.context) {
                return false;
              }
              if (
                !shared_objectIs(
                  prevContext.memoizedValue,
                  nextContext.memoizedValue
                )
              ) {
                return true;
              }
              prevContext = prevContext.next;
              nextContext = nextContext.next;
            }
            return false;
          }
          function isHookThatCanScheduleUpdate(hookObject) {
            var queue = hookObject.queue;
            if (!queue) {
              return false;
            }
            var boundHasOwnProperty = shared_hasOwnProperty.bind(queue);
            if (boundHasOwnProperty('pending')) {
              return true;
            }
            return (
              boundHasOwnProperty('value') &&
              boundHasOwnProperty('getSnapshot') &&
              typeof queue.getSnapshot === 'function'
            );
          }
          function didStatefulHookChange(prev, next) {
            var prevMemoizedState = prev.memoizedState;
            var nextMemoizedState = next.memoizedState;
            if (isHookThatCanScheduleUpdate(prev)) {
              return prevMemoizedState !== nextMemoizedState;
            }
            return false;
          }
          function getChangedHooksIndices(prev, next) {
            if (prev == null || next == null) {
              return null;
            }
            var indices = [];
            var index = 0;
            while (next !== null) {
              if (didStatefulHookChange(prev, next)) {
                indices.push(index);
              }
              next = next.next;
              prev = prev.next;
              index++;
            }
            return indices;
          }
          function getChangedKeys(prev, next) {
            if (prev == null || next == null) {
              return null;
            }
            var keys = new Set(
              [].concat(
                fiber_renderer_toConsumableArray(Object.keys(prev)),
                fiber_renderer_toConsumableArray(Object.keys(next))
              )
            );
            var changedKeys = [];
            var _iterator6 = renderer_createForOfIteratorHelper(keys),
              _step6;
            try {
              for (_iterator6.s(); !(_step6 = _iterator6.n()).done; ) {
                var key = _step6.value;
                if (prev[key] !== next[key]) {
                  changedKeys.push(key);
                }
              }
            } catch (err) {
              _iterator6.e(err);
            } finally {
              _iterator6.f();
            }
            return changedKeys;
          }
          function didFiberRender(prevFiber, nextFiber) {
            switch (nextFiber.tag) {
              case ClassComponent:
              case FunctionComponent:
              case ContextConsumer:
              case MemoComponent:
              case SimpleMemoComponent:
              case ForwardRef:
                var PerformedWork = 1;
                return (
                  (getFiberFlags(nextFiber) & PerformedWork) === PerformedWork
                );
              default:
                return (
                  prevFiber.memoizedProps !== nextFiber.memoizedProps ||
                  prevFiber.memoizedState !== nextFiber.memoizedState ||
                  prevFiber.ref !== nextFiber.ref
                );
            }
          }
          var pendingOperations = [];
          var pendingRealUnmountedIDs = [];
          var pendingOperationsQueue = [];
          var pendingStringTable = new Map();
          var pendingStringTableLength = 0;
          var pendingUnmountedRootID = null;
          function pushOperation(op) {
            if (false) {
            }
            pendingOperations.push(op);
          }
          function shouldBailoutWithPendingOperations() {
            if (isProfiling) {
              if (
                currentCommitProfilingMetadata != null &&
                currentCommitProfilingMetadata.durations.length > 0
              ) {
                return false;
              }
            }
            return (
              pendingOperations.length === 0 &&
              pendingRealUnmountedIDs.length === 0 &&
              pendingUnmountedRootID === null
            );
          }
          function flushOrQueueOperations(operations) {
            if (shouldBailoutWithPendingOperations()) {
              return;
            }
            if (pendingOperationsQueue !== null) {
              pendingOperationsQueue.push(operations);
            } else {
              hook.emit('operations', operations);
            }
          }
          function recordConsoleLogs(instance, componentLogsEntry) {
            if (componentLogsEntry === undefined) {
              if (instance.logCount === 0) {
                return false;
              }
              instance.logCount = 0;
              pushOperation(TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS);
              pushOperation(instance.id);
              pushOperation(0);
              pushOperation(0);
              return true;
            } else {
              var totalCount =
                componentLogsEntry.errorsCount +
                componentLogsEntry.warningsCount;
              if (instance.logCount === totalCount) {
                return false;
              }
              instance.logCount = totalCount;
              pushOperation(TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS);
              pushOperation(instance.id);
              pushOperation(componentLogsEntry.errorsCount);
              pushOperation(componentLogsEntry.warningsCount);
              return true;
            }
          }
          function flushPendingEvents(root) {
            if (shouldBailoutWithPendingOperations()) {
              return;
            }
            var numUnmountIDs =
              pendingRealUnmountedIDs.length +
              (pendingUnmountedRootID === null ? 0 : 1);
            var operations = new Array(
              2 +
                1 +
                pendingStringTableLength +
                (numUnmountIDs > 0 ? 2 + numUnmountIDs : 0) +
                pendingOperations.length
            );
            var i = 0;
            operations[i++] = rendererID;
            if (currentRoot === null) {
              operations[i++] = -1;
            } else {
              operations[i++] = currentRoot.id;
            }
            operations[i++] = pendingStringTableLength;
            pendingStringTable.forEach(function (entry, stringKey) {
              var encodedString = entry.encodedString;
              var length = encodedString.length;
              operations[i++] = length;
              for (var j2 = 0; j2 < length; j2++) {
                operations[i + j2] = encodedString[j2];
              }
              i += length;
            });
            if (numUnmountIDs > 0) {
              operations[i++] = TREE_OPERATION_REMOVE;
              operations[i++] = numUnmountIDs;
              for (var j = 0; j < pendingRealUnmountedIDs.length; j++) {
                operations[i++] = pendingRealUnmountedIDs[j];
              }
              if (pendingUnmountedRootID !== null) {
                operations[i] = pendingUnmountedRootID;
                i++;
              }
            }
            for (var _j = 0; _j < pendingOperations.length; _j++) {
              operations[i + _j] = pendingOperations[_j];
            }
            i += pendingOperations.length;
            flushOrQueueOperations(operations);
            pendingOperations.length = 0;
            pendingRealUnmountedIDs.length = 0;
            pendingUnmountedRootID = null;
            pendingStringTable.clear();
            pendingStringTableLength = 0;
          }
          function getStringID(string) {
            if (string === null) {
              return 0;
            }
            var existingEntry = pendingStringTable.get(string);
            if (existingEntry !== undefined) {
              return existingEntry.id;
            }
            var id = pendingStringTable.size + 1;
            var encodedString = utfEncodeString(string);
            pendingStringTable.set(string, {
              encodedString,
              id,
            });
            pendingStringTableLength += encodedString.length + 1;
            return id;
          }
          function recordMount(fiber, parentInstance) {
            var isRoot = fiber.tag === HostRoot;
            var fiberInstance;
            if (isRoot) {
              var entry = rootToFiberInstanceMap.get(fiber.stateNode);
              if (entry === undefined) {
                throw new Error(
                  'The root should have been registered at this point'
                );
              }
              fiberInstance = entry;
            } else {
              fiberInstance = createFiberInstance(fiber);
            }
            idToDevToolsInstanceMap.set(fiberInstance.id, fiberInstance);
            var id = fiberInstance.id;
            if (__DEBUG__) {
              debug2('recordMount()', fiberInstance, parentInstance);
            }
            var isProfilingSupported = fiber.hasOwnProperty('treeBaseDuration');
            if (isRoot) {
              var hasOwnerMetadata = fiber.hasOwnProperty('_debugOwner');
              var profilingFlags = 0;
              if (isProfilingSupported) {
                profilingFlags = PROFILING_FLAG_BASIC_SUPPORT;
                if (typeof injectProfilingHooks === 'function') {
                  profilingFlags |= PROFILING_FLAG_TIMELINE_SUPPORT;
                }
              }
              var isProductionBuildOfRenderer = renderer.bundleType === 0;
              pushOperation(TREE_OPERATION_ADD);
              pushOperation(id);
              pushOperation(ElementTypeRoot);
              pushOperation((fiber.mode & StrictModeBits) !== 0 ? 1 : 0);
              pushOperation(profilingFlags);
              pushOperation(
                !isProductionBuildOfRenderer && StrictModeBits !== 0 ? 1 : 0
              );
              pushOperation(hasOwnerMetadata ? 1 : 0);
              if (isProfiling) {
                if (displayNamesByRootID !== null) {
                  displayNamesByRootID.set(id, getDisplayNameForRoot(fiber));
                }
              }
            } else {
              var key = fiber.key;
              var displayName = getDisplayNameForFiber(fiber);
              var elementType = getElementTypeForFiber(fiber);
              var debugOwner = getUnfilteredOwner(fiber);
              var ownerInstance = findNearestOwnerInstance(
                parentInstance,
                debugOwner
              );
              if (
                ownerInstance !== null &&
                debugOwner === fiber._debugOwner &&
                fiber._debugStack != null &&
                ownerInstance.source === null
              ) {
                ownerInstance.source = fiber._debugStack;
              }
              var ownerID = ownerInstance === null ? 0 : ownerInstance.id;
              var parentID = parentInstance
                ? parentInstance.kind === FILTERED_FIBER_INSTANCE
                  ? parentInstance.parent.id
                  : parentInstance.id
                : 0;
              var displayNameStringID = getStringID(displayName);
              var keyString = key === null ? null : String(key);
              var keyStringID = getStringID(keyString);
              pushOperation(TREE_OPERATION_ADD);
              pushOperation(id);
              pushOperation(elementType);
              pushOperation(parentID);
              pushOperation(ownerID);
              pushOperation(displayNameStringID);
              pushOperation(keyStringID);
              if ((fiber.mode & StrictModeBits) !== 0) {
                var parentFiber = null;
                var parentFiberInstance = parentInstance;
                while (parentFiberInstance !== null) {
                  if (parentFiberInstance.kind === FIBER_INSTANCE) {
                    parentFiber = parentFiberInstance.data;
                    break;
                  }
                  parentFiberInstance = parentFiberInstance.parent;
                }
                if (
                  parentFiber === null ||
                  (parentFiber.mode & StrictModeBits) === 0
                ) {
                  pushOperation(TREE_OPERATION_SET_SUBTREE_MODE);
                  pushOperation(id);
                  pushOperation(StrictMode);
                }
              }
            }
            var componentLogsEntry = fiberToComponentLogsMap.get(fiber);
            if (componentLogsEntry === undefined && fiber.alternate !== null) {
              componentLogsEntry = fiberToComponentLogsMap.get(fiber.alternate);
            }
            recordConsoleLogs(fiberInstance, componentLogsEntry);
            if (isProfilingSupported) {
              recordProfilingDurations(fiberInstance, null);
            }
            return fiberInstance;
          }
          function recordVirtualMount(instance, parentInstance, secondaryEnv) {
            var id = instance.id;
            idToDevToolsInstanceMap.set(id, instance);
            var componentInfo = instance.data;
            var key =
              typeof componentInfo.key === 'string' ? componentInfo.key : null;
            var env = componentInfo.env;
            var displayName = componentInfo.name || '';
            if (typeof env === 'string') {
              if (secondaryEnv !== null) {
                displayName = secondaryEnv + '(' + displayName + ')';
              }
              displayName = env + '(' + displayName + ')';
            }
            var elementType = types_ElementTypeVirtual;
            var debugOwner = getUnfilteredOwner(componentInfo);
            var ownerInstance = findNearestOwnerInstance(
              parentInstance,
              debugOwner
            );
            if (
              ownerInstance !== null &&
              debugOwner === componentInfo.owner &&
              componentInfo.debugStack != null &&
              ownerInstance.source === null
            ) {
              ownerInstance.source = componentInfo.debugStack;
            }
            var ownerID = ownerInstance === null ? 0 : ownerInstance.id;
            var parentID = parentInstance
              ? parentInstance.kind === FILTERED_FIBER_INSTANCE
                ? parentInstance.parent.id
                : parentInstance.id
              : 0;
            var displayNameStringID = getStringID(displayName);
            var keyString = key === null ? null : String(key);
            var keyStringID = getStringID(keyString);
            pushOperation(TREE_OPERATION_ADD);
            pushOperation(id);
            pushOperation(elementType);
            pushOperation(parentID);
            pushOperation(ownerID);
            pushOperation(displayNameStringID);
            pushOperation(keyStringID);
            var componentLogsEntry =
              componentInfoToComponentLogsMap.get(componentInfo);
            recordConsoleLogs(instance, componentLogsEntry);
          }
          function recordUnmount(fiberInstance) {
            var fiber = fiberInstance.data;
            if (__DEBUG__) {
              debug2('recordUnmount()', fiberInstance, reconcilingParent);
            }
            if (trackedPathMatchInstance === fiberInstance) {
              setTrackedPath(null);
            }
            var id = fiberInstance.id;
            var isRoot = fiber.tag === HostRoot;
            if (isRoot) {
              pendingUnmountedRootID = id;
            } else {
              pendingRealUnmountedIDs.push(id);
            }
            idToDevToolsInstanceMap.delete(fiberInstance.id);
            untrackFiber(fiberInstance, fiber);
          }
          var remainingReconcilingChildren = null;
          var previouslyReconciledSibling = null;
          var reconcilingParent = null;
          function insertChild(instance) {
            var parentInstance = reconcilingParent;
            if (parentInstance === null) {
              return;
            }
            instance.parent = parentInstance;
            if (previouslyReconciledSibling === null) {
              previouslyReconciledSibling = instance;
              parentInstance.firstChild = instance;
            } else {
              previouslyReconciledSibling.nextSibling = instance;
              previouslyReconciledSibling = instance;
            }
            instance.nextSibling = null;
          }
          function moveChild(instance, previousSibling) {
            removeChild(instance, previousSibling);
            insertChild(instance);
          }
          function removeChild(instance, previousSibling) {
            if (instance.parent === null) {
              if (remainingReconcilingChildren === instance) {
                throw new Error(
                  'Remaining children should not have items with no parent'
                );
              } else if (instance.nextSibling !== null) {
                throw new Error(
                  'A deleted instance should not have next siblings'
                );
              }
              return;
            }
            var parentInstance = reconcilingParent;
            if (parentInstance === null) {
              throw new Error('Should not have a parent if we are at the root');
            }
            if (instance.parent !== parentInstance) {
              throw new Error(
                'Cannot remove a node from a different parent than is being reconciled.'
              );
            }
            if (previousSibling === null) {
              if (remainingReconcilingChildren !== instance) {
                throw new Error(
                  'Expected a placed child to be moved from the remaining set.'
                );
              }
              remainingReconcilingChildren = instance.nextSibling;
            } else {
              previousSibling.nextSibling = instance.nextSibling;
            }
            instance.nextSibling = null;
            instance.parent = null;
          }
          function unmountRemainingChildren() {
            var child = remainingReconcilingChildren;
            while (child !== null) {
              unmountInstanceRecursively(child);
              child = remainingReconcilingChildren;
            }
          }
          function mountVirtualInstanceRecursively(
            virtualInstance,
            firstChild,
            lastChild,
            traceNearestHostComponentUpdate,
            virtualLevel
          ) {
            var mightSiblingsBeOnTrackedPath =
              updateVirtualTrackedPathStateBeforeMount(
                virtualInstance,
                reconcilingParent
              );
            var stashedParent = reconcilingParent;
            var stashedPrevious = previouslyReconciledSibling;
            var stashedRemaining = remainingReconcilingChildren;
            reconcilingParent = virtualInstance;
            previouslyReconciledSibling = null;
            remainingReconcilingChildren = null;
            try {
              mountVirtualChildrenRecursively(
                firstChild,
                lastChild,
                traceNearestHostComponentUpdate,
                virtualLevel + 1
              );
              recordVirtualProfilingDurations(virtualInstance);
            } finally {
              reconcilingParent = stashedParent;
              previouslyReconciledSibling = stashedPrevious;
              remainingReconcilingChildren = stashedRemaining;
              updateTrackedPathStateAfterMount(mightSiblingsBeOnTrackedPath);
            }
          }
          function recordVirtualUnmount(instance) {
            if (trackedPathMatchInstance === instance) {
              setTrackedPath(null);
            }
            var id = instance.id;
            pendingRealUnmountedIDs.push(id);
          }
          function getSecondaryEnvironmentName(debugInfo, index) {
            if (debugInfo != null) {
              var componentInfo = debugInfo[index];
              for (var i = index + 1; i < debugInfo.length; i++) {
                var debugEntry = debugInfo[i];
                if (typeof debugEntry.env === 'string') {
                  return componentInfo.env !== debugEntry.env
                    ? debugEntry.env
                    : null;
                }
              }
            }
            return null;
          }
          function mountVirtualChildrenRecursively(
            firstChild,
            lastChild,
            traceNearestHostComponentUpdate,
            virtualLevel
          ) {
            var fiber = firstChild;
            var previousVirtualInstance = null;
            var previousVirtualInstanceFirstFiber = firstChild;
            while (fiber !== null && fiber !== lastChild) {
              var level = 0;
              if (fiber._debugInfo) {
                for (var i = 0; i < fiber._debugInfo.length; i++) {
                  var debugEntry = fiber._debugInfo[i];
                  if (typeof debugEntry.name !== 'string') {
                    continue;
                  }
                  var componentInfo = debugEntry;
                  var secondaryEnv = getSecondaryEnvironmentName(
                    fiber._debugInfo,
                    i
                  );
                  if (componentInfo.env != null) {
                    knownEnvironmentNames.add(componentInfo.env);
                  }
                  if (secondaryEnv !== null) {
                    knownEnvironmentNames.add(secondaryEnv);
                  }
                  if (shouldFilterVirtual(componentInfo, secondaryEnv)) {
                    continue;
                  }
                  if (level === virtualLevel) {
                    if (
                      previousVirtualInstance === null ||
                      previousVirtualInstance.data !== debugEntry
                    ) {
                      if (previousVirtualInstance !== null) {
                        mountVirtualInstanceRecursively(
                          previousVirtualInstance,
                          previousVirtualInstanceFirstFiber,
                          fiber,
                          traceNearestHostComponentUpdate,
                          virtualLevel
                        );
                      }
                      previousVirtualInstance =
                        createVirtualInstance(componentInfo);
                      recordVirtualMount(
                        previousVirtualInstance,
                        reconcilingParent,
                        secondaryEnv
                      );
                      insertChild(previousVirtualInstance);
                      previousVirtualInstanceFirstFiber = fiber;
                    }
                    level++;
                    break;
                  } else {
                    level++;
                  }
                }
              }
              if (level === virtualLevel) {
                if (previousVirtualInstance !== null) {
                  mountVirtualInstanceRecursively(
                    previousVirtualInstance,
                    previousVirtualInstanceFirstFiber,
                    fiber,
                    traceNearestHostComponentUpdate,
                    virtualLevel
                  );
                  previousVirtualInstance = null;
                }
                mountFiberRecursively(fiber, traceNearestHostComponentUpdate);
              }
              fiber = fiber.sibling;
            }
            if (previousVirtualInstance !== null) {
              mountVirtualInstanceRecursively(
                previousVirtualInstance,
                previousVirtualInstanceFirstFiber,
                null,
                traceNearestHostComponentUpdate,
                virtualLevel
              );
            }
          }
          function mountChildrenRecursively(
            firstChild,
            traceNearestHostComponentUpdate
          ) {
            mountVirtualChildrenRecursively(
              firstChild,
              null,
              traceNearestHostComponentUpdate,
              0
            );
          }
          function mountFiberRecursively(
            fiber,
            traceNearestHostComponentUpdate
          ) {
            var shouldIncludeInTree = !shouldFilterFiber(fiber);
            var newInstance = null;
            if (shouldIncludeInTree) {
              newInstance = recordMount(fiber, reconcilingParent);
              insertChild(newInstance);
              if (__DEBUG__) {
                debug2(
                  'mountFiberRecursively()',
                  newInstance,
                  reconcilingParent
                );
              }
            } else if (
              reconcilingParent !== null &&
              reconcilingParent.kind === VIRTUAL_INSTANCE
            ) {
              if (
                reconcilingParent.data === fiber._debugOwner &&
                fiber._debugStack != null &&
                reconcilingParent.source === null
              ) {
                reconcilingParent.source = fiber._debugStack;
              }
              newInstance = createFilteredFiberInstance(fiber);
              insertChild(newInstance);
              if (__DEBUG__) {
                debug2(
                  'mountFiberRecursively()',
                  newInstance,
                  reconcilingParent
                );
              }
            }
            var mightSiblingsBeOnTrackedPath =
              updateTrackedPathStateBeforeMount(fiber, newInstance);
            var stashedParent = reconcilingParent;
            var stashedPrevious = previouslyReconciledSibling;
            var stashedRemaining = remainingReconcilingChildren;
            if (newInstance !== null) {
              reconcilingParent = newInstance;
              previouslyReconciledSibling = null;
              remainingReconcilingChildren = null;
            }
            try {
              if (traceUpdatesEnabled) {
                if (traceNearestHostComponentUpdate) {
                  var elementType = getElementTypeForFiber(fiber);
                  if (elementType === ElementTypeHostComponent) {
                    traceUpdatesForNodes.add(fiber.stateNode);
                    traceNearestHostComponentUpdate = false;
                  }
                }
              }
              if (fiber.tag === HostHoistable) {
                var nearestInstance = reconcilingParent;
                if (nearestInstance === null) {
                  throw new Error(
                    'Did not expect a host hoistable to be the root'
                  );
                }
                aquireHostResource(nearestInstance, fiber.memoizedState);
              } else if (
                fiber.tag === HostComponent ||
                fiber.tag === HostText ||
                fiber.tag === HostSingleton
              ) {
                var _nearestInstance = reconcilingParent;
                if (_nearestInstance === null) {
                  throw new Error(
                    'Did not expect a host hoistable to be the root'
                  );
                }
                aquireHostInstance(_nearestInstance, fiber.stateNode);
              }
              if (fiber.tag === SuspenseComponent) {
                var isTimedOut = fiber.memoizedState !== null;
                if (isTimedOut) {
                  var primaryChildFragment = fiber.child;
                  var fallbackChildFragment = primaryChildFragment
                    ? primaryChildFragment.sibling
                    : null;
                  if (fallbackChildFragment) {
                    var fallbackChild = fallbackChildFragment.child;
                    if (fallbackChild !== null) {
                      updateTrackedPathStateBeforeMount(
                        fallbackChildFragment,
                        null
                      );
                      mountChildrenRecursively(
                        fallbackChild,
                        traceNearestHostComponentUpdate
                      );
                    }
                  }
                } else {
                  var primaryChild = null;
                  var areSuspenseChildrenConditionallyWrapped =
                    OffscreenComponent === -1;
                  if (areSuspenseChildrenConditionallyWrapped) {
                    primaryChild = fiber.child;
                  } else if (fiber.child !== null) {
                    primaryChild = fiber.child.child;
                    updateTrackedPathStateBeforeMount(fiber.child, null);
                  }
                  if (primaryChild !== null) {
                    mountChildrenRecursively(
                      primaryChild,
                      traceNearestHostComponentUpdate
                    );
                  }
                }
              } else {
                if (fiber.child !== null) {
                  mountChildrenRecursively(
                    fiber.child,
                    traceNearestHostComponentUpdate
                  );
                }
              }
            } finally {
              if (newInstance !== null) {
                reconcilingParent = stashedParent;
                previouslyReconciledSibling = stashedPrevious;
                remainingReconcilingChildren = stashedRemaining;
              }
            }
            updateTrackedPathStateAfterMount(mightSiblingsBeOnTrackedPath);
          }
          function unmountInstanceRecursively(instance) {
            if (__DEBUG__) {
              debug2(
                'unmountInstanceRecursively()',
                instance,
                reconcilingParent
              );
            }
            var stashedParent = reconcilingParent;
            var stashedPrevious = previouslyReconciledSibling;
            var stashedRemaining = remainingReconcilingChildren;
            reconcilingParent = instance;
            previouslyReconciledSibling = null;
            remainingReconcilingChildren = instance.firstChild;
            instance.firstChild = null;
            try {
              unmountRemainingChildren();
            } finally {
              reconcilingParent = stashedParent;
              previouslyReconciledSibling = stashedPrevious;
              remainingReconcilingChildren = stashedRemaining;
            }
            if (instance.kind === FIBER_INSTANCE) {
              recordUnmount(instance);
            } else if (instance.kind === VIRTUAL_INSTANCE) {
              recordVirtualUnmount(instance);
            } else {
              untrackFiber(instance, instance.data);
            }
            removeChild(instance, null);
          }
          function recordProfilingDurations(fiberInstance, prevFiber) {
            var id = fiberInstance.id;
            var fiber = fiberInstance.data;
            var { actualDuration, treeBaseDuration } = fiber;
            fiberInstance.treeBaseDuration = treeBaseDuration || 0;
            if (isProfiling) {
              if (
                prevFiber == null ||
                treeBaseDuration !== prevFiber.treeBaseDuration
              ) {
                var convertedTreeBaseDuration = Math.floor(
                  (treeBaseDuration || 0) * 1000
                );
                pushOperation(TREE_OPERATION_UPDATE_TREE_BASE_DURATION);
                pushOperation(id);
                pushOperation(convertedTreeBaseDuration);
              }
              if (prevFiber == null || didFiberRender(prevFiber, fiber)) {
                if (actualDuration != null) {
                  var selfDuration = actualDuration;
                  var child = fiber.child;
                  while (child !== null) {
                    selfDuration -= child.actualDuration || 0;
                    child = child.sibling;
                  }
                  var metadata = currentCommitProfilingMetadata;
                  metadata.durations.push(id, actualDuration, selfDuration);
                  metadata.maxActualDuration = Math.max(
                    metadata.maxActualDuration,
                    actualDuration
                  );
                  if (recordChangeDescriptions) {
                    var changeDescription = getChangeDescription(
                      prevFiber,
                      fiber
                    );
                    if (changeDescription !== null) {
                      if (metadata.changeDescriptions !== null) {
                        metadata.changeDescriptions.set(id, changeDescription);
                      }
                    }
                  }
                }
              }
              var fiberRoot = currentRoot.data.stateNode;
              var updaters = fiberRoot.memoizedUpdaters;
              if (
                updaters != null &&
                (updaters.has(fiber) ||
                  (fiber.alternate !== null && updaters.has(fiber.alternate)))
              ) {
                var _metadata = currentCommitProfilingMetadata;
                if (_metadata.updaters === null) {
                  _metadata.updaters = [];
                }
                _metadata.updaters.push(
                  instanceToSerializedElement(fiberInstance)
                );
              }
            }
          }
          function recordVirtualProfilingDurations(virtualInstance) {
            var id = virtualInstance.id;
            var treeBaseDuration = 0;
            for (
              var child = virtualInstance.firstChild;
              child !== null;
              child = child.nextSibling
            ) {
              treeBaseDuration += child.treeBaseDuration;
            }
            if (isProfiling) {
              var previousTreeBaseDuration = virtualInstance.treeBaseDuration;
              if (treeBaseDuration !== previousTreeBaseDuration) {
                var convertedTreeBaseDuration = Math.floor(
                  (treeBaseDuration || 0) * 1000
                );
                pushOperation(TREE_OPERATION_UPDATE_TREE_BASE_DURATION);
                pushOperation(id);
                pushOperation(convertedTreeBaseDuration);
              }
            }
            virtualInstance.treeBaseDuration = treeBaseDuration;
          }
          function recordResetChildren(parentInstance) {
            if (__DEBUG__) {
              if (parentInstance.firstChild !== null) {
                debug2(
                  'recordResetChildren()',
                  parentInstance.firstChild,
                  parentInstance
                );
              }
            }
            var nextChildren = [];
            var child = parentInstance.firstChild;
            while (child !== null) {
              if (child.kind === FILTERED_FIBER_INSTANCE) {
                for (
                  var innerChild = parentInstance.firstChild;
                  innerChild !== null;
                  innerChild = innerChild.nextSibling
                ) {
                  nextChildren.push(innerChild.id);
                }
              } else {
                nextChildren.push(child.id);
              }
              child = child.nextSibling;
            }
            var numChildren = nextChildren.length;
            if (numChildren < 2) {
              return;
            }
            pushOperation(TREE_OPERATION_REORDER_CHILDREN);
            pushOperation(parentInstance.id);
            pushOperation(numChildren);
            for (var i = 0; i < nextChildren.length; i++) {
              pushOperation(nextChildren[i]);
            }
          }
          function updateVirtualInstanceRecursively(
            virtualInstance,
            nextFirstChild,
            nextLastChild,
            prevFirstChild,
            traceNearestHostComponentUpdate,
            virtualLevel
          ) {
            var stashedParent = reconcilingParent;
            var stashedPrevious = previouslyReconciledSibling;
            var stashedRemaining = remainingReconcilingChildren;
            reconcilingParent = virtualInstance;
            previouslyReconciledSibling = null;
            remainingReconcilingChildren = virtualInstance.firstChild;
            virtualInstance.firstChild = null;
            try {
              if (
                updateVirtualChildrenRecursively(
                  nextFirstChild,
                  nextLastChild,
                  prevFirstChild,
                  traceNearestHostComponentUpdate,
                  virtualLevel + 1
                )
              ) {
                recordResetChildren(virtualInstance);
              }
              var componentLogsEntry = componentInfoToComponentLogsMap.get(
                virtualInstance.data
              );
              recordConsoleLogs(virtualInstance, componentLogsEntry);
              recordVirtualProfilingDurations(virtualInstance);
            } finally {
              unmountRemainingChildren();
              reconcilingParent = stashedParent;
              previouslyReconciledSibling = stashedPrevious;
              remainingReconcilingChildren = stashedRemaining;
            }
          }
          function updateVirtualChildrenRecursively(
            nextFirstChild,
            nextLastChild,
            prevFirstChild,
            traceNearestHostComponentUpdate,
            virtualLevel
          ) {
            var shouldResetChildren = false;
            var nextChild = nextFirstChild;
            var prevChildAtSameIndex = prevFirstChild;
            var previousVirtualInstance = null;
            var previousVirtualInstanceWasMount = false;
            var previousVirtualInstanceNextFirstFiber = nextFirstChild;
            var previousVirtualInstancePrevFirstFiber = prevFirstChild;
            while (nextChild !== null && nextChild !== nextLastChild) {
              var level = 0;
              if (nextChild._debugInfo) {
                for (var i = 0; i < nextChild._debugInfo.length; i++) {
                  var debugEntry = nextChild._debugInfo[i];
                  if (typeof debugEntry.name !== 'string') {
                    continue;
                  }
                  var componentInfo = debugEntry;
                  var secondaryEnv = getSecondaryEnvironmentName(
                    nextChild._debugInfo,
                    i
                  );
                  if (componentInfo.env != null) {
                    knownEnvironmentNames.add(componentInfo.env);
                  }
                  if (secondaryEnv !== null) {
                    knownEnvironmentNames.add(secondaryEnv);
                  }
                  if (shouldFilterVirtual(componentInfo, secondaryEnv)) {
                    continue;
                  }
                  if (level === virtualLevel) {
                    if (
                      previousVirtualInstance === null ||
                      previousVirtualInstance.data !== componentInfo
                    ) {
                      if (previousVirtualInstance !== null) {
                        if (previousVirtualInstanceWasMount) {
                          mountVirtualInstanceRecursively(
                            previousVirtualInstance,
                            previousVirtualInstanceNextFirstFiber,
                            nextChild,
                            traceNearestHostComponentUpdate,
                            virtualLevel
                          );
                        } else {
                          updateVirtualInstanceRecursively(
                            previousVirtualInstance,
                            previousVirtualInstanceNextFirstFiber,
                            nextChild,
                            previousVirtualInstancePrevFirstFiber,
                            traceNearestHostComponentUpdate,
                            virtualLevel
                          );
                        }
                      }
                      var previousSiblingOfBestMatch = null;
                      var bestMatch = remainingReconcilingChildren;
                      if (componentInfo.key != null) {
                        bestMatch = remainingReconcilingChildren;
                        while (bestMatch !== null) {
                          if (
                            bestMatch.kind === VIRTUAL_INSTANCE &&
                            bestMatch.data.key === componentInfo.key
                          ) {
                            break;
                          }
                          previousSiblingOfBestMatch = bestMatch;
                          bestMatch = bestMatch.nextSibling;
                        }
                      }
                      if (
                        bestMatch !== null &&
                        bestMatch.kind === VIRTUAL_INSTANCE &&
                        bestMatch.data.name === componentInfo.name &&
                        bestMatch.data.env === componentInfo.env &&
                        bestMatch.data.key === componentInfo.key
                      ) {
                        bestMatch.data = componentInfo;
                        moveChild(bestMatch, previousSiblingOfBestMatch);
                        previousVirtualInstance = bestMatch;
                        previousVirtualInstanceWasMount = false;
                      } else {
                        var newVirtualInstance =
                          createVirtualInstance(componentInfo);
                        recordVirtualMount(
                          newVirtualInstance,
                          reconcilingParent,
                          secondaryEnv
                        );
                        insertChild(newVirtualInstance);
                        previousVirtualInstance = newVirtualInstance;
                        previousVirtualInstanceWasMount = true;
                        shouldResetChildren = true;
                      }
                      previousVirtualInstanceNextFirstFiber = nextChild;
                      previousVirtualInstancePrevFirstFiber =
                        prevChildAtSameIndex;
                    }
                    level++;
                    break;
                  } else {
                    level++;
                  }
                }
              }
              if (level === virtualLevel) {
                if (previousVirtualInstance !== null) {
                  if (previousVirtualInstanceWasMount) {
                    mountVirtualInstanceRecursively(
                      previousVirtualInstance,
                      previousVirtualInstanceNextFirstFiber,
                      nextChild,
                      traceNearestHostComponentUpdate,
                      virtualLevel
                    );
                  } else {
                    updateVirtualInstanceRecursively(
                      previousVirtualInstance,
                      previousVirtualInstanceNextFirstFiber,
                      nextChild,
                      previousVirtualInstancePrevFirstFiber,
                      traceNearestHostComponentUpdate,
                      virtualLevel
                    );
                  }
                  previousVirtualInstance = null;
                }
                var prevChild = undefined;
                if (prevChildAtSameIndex === nextChild) {
                  prevChild = nextChild;
                } else {
                  prevChild = nextChild.alternate;
                }
                var previousSiblingOfExistingInstance = null;
                var existingInstance = null;
                if (prevChild !== null) {
                  existingInstance = remainingReconcilingChildren;
                  while (existingInstance !== null) {
                    if (existingInstance.data === prevChild) {
                      break;
                    }
                    previousSiblingOfExistingInstance = existingInstance;
                    existingInstance = existingInstance.nextSibling;
                  }
                }
                if (existingInstance !== null) {
                  var fiberInstance = existingInstance;
                  if (prevChild !== prevChildAtSameIndex) {
                    shouldResetChildren = true;
                  }
                  moveChild(fiberInstance, previousSiblingOfExistingInstance);
                  if (
                    updateFiberRecursively(
                      fiberInstance,
                      nextChild,
                      prevChild,
                      traceNearestHostComponentUpdate
                    )
                  ) {
                    shouldResetChildren = true;
                  }
                } else if (prevChild !== null && shouldFilterFiber(nextChild)) {
                  if (
                    updateFiberRecursively(
                      null,
                      nextChild,
                      prevChild,
                      traceNearestHostComponentUpdate
                    )
                  ) {
                    shouldResetChildren = true;
                  }
                } else {
                  mountFiberRecursively(
                    nextChild,
                    traceNearestHostComponentUpdate
                  );
                  shouldResetChildren = true;
                }
              }
              nextChild = nextChild.sibling;
              if (!shouldResetChildren && prevChildAtSameIndex !== null) {
                prevChildAtSameIndex = prevChildAtSameIndex.sibling;
              }
            }
            if (previousVirtualInstance !== null) {
              if (previousVirtualInstanceWasMount) {
                mountVirtualInstanceRecursively(
                  previousVirtualInstance,
                  previousVirtualInstanceNextFirstFiber,
                  null,
                  traceNearestHostComponentUpdate,
                  virtualLevel
                );
              } else {
                updateVirtualInstanceRecursively(
                  previousVirtualInstance,
                  previousVirtualInstanceNextFirstFiber,
                  null,
                  previousVirtualInstancePrevFirstFiber,
                  traceNearestHostComponentUpdate,
                  virtualLevel
                );
              }
            }
            if (prevChildAtSameIndex !== null) {
              shouldResetChildren = true;
            }
            return shouldResetChildren;
          }
          function updateChildrenRecursively(
            nextFirstChild,
            prevFirstChild,
            traceNearestHostComponentUpdate
          ) {
            if (nextFirstChild === null) {
              return prevFirstChild !== null;
            }
            return updateVirtualChildrenRecursively(
              nextFirstChild,
              null,
              prevFirstChild,
              traceNearestHostComponentUpdate,
              0
            );
          }
          function updateFiberRecursively(
            fiberInstance,
            nextFiber,
            prevFiber,
            traceNearestHostComponentUpdate
          ) {
            if (__DEBUG__) {
              if (fiberInstance !== null) {
                debug2(
                  'updateFiberRecursively()',
                  fiberInstance,
                  reconcilingParent
                );
              }
            }
            if (traceUpdatesEnabled) {
              var elementType = getElementTypeForFiber(nextFiber);
              if (traceNearestHostComponentUpdate) {
                if (elementType === ElementTypeHostComponent) {
                  traceUpdatesForNodes.add(nextFiber.stateNode);
                  traceNearestHostComponentUpdate = false;
                }
              } else {
                if (
                  elementType === types_ElementTypeFunction ||
                  elementType === types_ElementTypeClass ||
                  elementType === ElementTypeContext ||
                  elementType === types_ElementTypeMemo ||
                  elementType === types_ElementTypeForwardRef
                ) {
                  traceNearestHostComponentUpdate = didFiberRender(
                    prevFiber,
                    nextFiber
                  );
                }
              }
            }
            var stashedParent = reconcilingParent;
            var stashedPrevious = previouslyReconciledSibling;
            var stashedRemaining = remainingReconcilingChildren;
            if (fiberInstance !== null) {
              fiberInstance.data = nextFiber;
              if (
                mostRecentlyInspectedElement !== null &&
                mostRecentlyInspectedElement.id === fiberInstance.id &&
                didFiberRender(prevFiber, nextFiber)
              ) {
                hasElementUpdatedSinceLastInspected = true;
              }
              reconcilingParent = fiberInstance;
              previouslyReconciledSibling = null;
              remainingReconcilingChildren = fiberInstance.firstChild;
              fiberInstance.firstChild = null;
            }
            try {
              if (
                nextFiber.tag === HostHoistable &&
                prevFiber.memoizedState !== nextFiber.memoizedState
              ) {
                var nearestInstance = reconcilingParent;
                if (nearestInstance === null) {
                  throw new Error(
                    'Did not expect a host hoistable to be the root'
                  );
                }
                releaseHostResource(nearestInstance, prevFiber.memoizedState);
                aquireHostResource(nearestInstance, nextFiber.memoizedState);
              } else if (
                (nextFiber.tag === HostComponent ||
                  nextFiber.tag === HostText ||
                  nextFiber.tag === HostSingleton) &&
                prevFiber.stateNode !== nextFiber.stateNode
              ) {
                var _nearestInstance2 = reconcilingParent;
                if (_nearestInstance2 === null) {
                  throw new Error(
                    'Did not expect a host hoistable to be the root'
                  );
                }
                releaseHostInstance(_nearestInstance2, prevFiber.stateNode);
                aquireHostInstance(_nearestInstance2, nextFiber.stateNode);
              }
              var isSuspense = nextFiber.tag === SuspenseComponent;
              var shouldResetChildren = false;
              var prevDidTimeout =
                isSuspense && prevFiber.memoizedState !== null;
              var nextDidTimeOut =
                isSuspense && nextFiber.memoizedState !== null;
              if (prevDidTimeout && nextDidTimeOut) {
                var nextFiberChild = nextFiber.child;
                var nextFallbackChildSet = nextFiberChild
                  ? nextFiberChild.sibling
                  : null;
                var prevFiberChild = prevFiber.child;
                var prevFallbackChildSet = prevFiberChild
                  ? prevFiberChild.sibling
                  : null;
                if (
                  prevFallbackChildSet == null &&
                  nextFallbackChildSet != null
                ) {
                  mountChildrenRecursively(
                    nextFallbackChildSet,
                    traceNearestHostComponentUpdate
                  );
                  shouldResetChildren = true;
                }
                if (
                  nextFallbackChildSet != null &&
                  prevFallbackChildSet != null &&
                  updateChildrenRecursively(
                    nextFallbackChildSet,
                    prevFallbackChildSet,
                    traceNearestHostComponentUpdate
                  )
                ) {
                  shouldResetChildren = true;
                }
              } else if (prevDidTimeout && !nextDidTimeOut) {
                var nextPrimaryChildSet = nextFiber.child;
                if (nextPrimaryChildSet !== null) {
                  mountChildrenRecursively(
                    nextPrimaryChildSet,
                    traceNearestHostComponentUpdate
                  );
                }
                shouldResetChildren = true;
              } else if (!prevDidTimeout && nextDidTimeOut) {
                var _nextFiberChild = nextFiber.child;
                var _nextFallbackChildSet = _nextFiberChild
                  ? _nextFiberChild.sibling
                  : null;
                if (_nextFallbackChildSet != null) {
                  mountChildrenRecursively(
                    _nextFallbackChildSet,
                    traceNearestHostComponentUpdate
                  );
                  shouldResetChildren = true;
                }
              } else {
                if (nextFiber.child !== prevFiber.child) {
                  if (
                    updateChildrenRecursively(
                      nextFiber.child,
                      prevFiber.child,
                      traceNearestHostComponentUpdate
                    )
                  ) {
                    shouldResetChildren = true;
                  }
                } else {
                  if (fiberInstance !== null) {
                    fiberInstance.firstChild = remainingReconcilingChildren;
                    remainingReconcilingChildren = null;
                    if (traceUpdatesEnabled) {
                      if (traceNearestHostComponentUpdate) {
                        var hostInstances =
                          findAllCurrentHostInstances(fiberInstance);
                        hostInstances.forEach(function (hostInstance) {
                          traceUpdatesForNodes.add(hostInstance);
                        });
                      }
                    }
                  } else {
                    if (
                      updateChildrenRecursively(
                        nextFiber.child,
                        prevFiber.child,
                        false
                      )
                    ) {
                      throw new Error(
                        'The children should not have changed if we pass in the same set.'
                      );
                    }
                  }
                }
              }
              if (fiberInstance !== null) {
                var componentLogsEntry = fiberToComponentLogsMap.get(
                  fiberInstance.data
                );
                if (
                  componentLogsEntry === undefined &&
                  fiberInstance.data.alternate
                ) {
                  componentLogsEntry = fiberToComponentLogsMap.get(
                    fiberInstance.data.alternate
                  );
                }
                recordConsoleLogs(fiberInstance, componentLogsEntry);
                var isProfilingSupported =
                  nextFiber.hasOwnProperty('treeBaseDuration');
                if (isProfilingSupported) {
                  recordProfilingDurations(fiberInstance, prevFiber);
                }
              }
              if (shouldResetChildren) {
                if (fiberInstance !== null) {
                  recordResetChildren(fiberInstance);
                  return false;
                } else {
                  return true;
                }
              } else {
                return false;
              }
            } finally {
              if (fiberInstance !== null) {
                unmountRemainingChildren();
                reconcilingParent = stashedParent;
                previouslyReconciledSibling = stashedPrevious;
                remainingReconcilingChildren = stashedRemaining;
              }
            }
          }
          function cleanup() {
            isProfiling = false;
          }
          function rootSupportsProfiling(root) {
            if (root.memoizedInteractions != null) {
              return true;
            } else if (
              root.current != null &&
              root.current.hasOwnProperty('treeBaseDuration')
            ) {
              return true;
            } else {
              return false;
            }
          }
          function flushInitialOperations() {
            var localPendingOperationsQueue = pendingOperationsQueue;
            pendingOperationsQueue = null;
            if (
              localPendingOperationsQueue !== null &&
              localPendingOperationsQueue.length > 0
            ) {
              localPendingOperationsQueue.forEach(function (operations) {
                hook.emit('operations', operations);
              });
            } else {
              if (trackedPath !== null) {
                mightBeOnTrackedPath = true;
              }
              hook.getFiberRoots(rendererID).forEach(function (root) {
                var current = root.current;
                var newRoot = createFiberInstance(current);
                rootToFiberInstanceMap.set(root, newRoot);
                idToDevToolsInstanceMap.set(newRoot.id, newRoot);
                currentRoot = newRoot;
                setRootPseudoKey(currentRoot.id, root.current);
                if (isProfiling && rootSupportsProfiling(root)) {
                  currentCommitProfilingMetadata = {
                    changeDescriptions: recordChangeDescriptions
                      ? new Map()
                      : null,
                    durations: [],
                    commitTime: renderer_getCurrentTime() - profilingStartTime,
                    maxActualDuration: 0,
                    priorityLevel: null,
                    updaters: null,
                    effectDuration: null,
                    passiveEffectDuration: null,
                  };
                }
                mountFiberRecursively(root.current, false);
                flushPendingEvents(root);
                needsToFlushComponentLogs = false;
                currentRoot = null;
              });
            }
          }
          function handleCommitFiberUnmount(fiber) {}
          function handlePostCommitFiberRoot(root) {
            if (isProfiling && rootSupportsProfiling(root)) {
              if (currentCommitProfilingMetadata !== null) {
                var _getEffectDurations = getEffectDurations(root),
                  effectDuration = _getEffectDurations.effectDuration,
                  passiveEffectDuration =
                    _getEffectDurations.passiveEffectDuration;
                currentCommitProfilingMetadata.effectDuration = effectDuration;
                currentCommitProfilingMetadata.passiveEffectDuration =
                  passiveEffectDuration;
              }
            }
            if (needsToFlushComponentLogs) {
              bruteForceFlushErrorsAndWarnings();
            }
          }
          function handleCommitFiberRoot(root, priorityLevel) {
            var current = root.current;
            var prevFiber = null;
            var rootInstance = rootToFiberInstanceMap.get(root);
            if (!rootInstance) {
              rootInstance = createFiberInstance(current);
              rootToFiberInstanceMap.set(root, rootInstance);
              idToDevToolsInstanceMap.set(rootInstance.id, rootInstance);
            } else {
              prevFiber = rootInstance.data;
            }
            currentRoot = rootInstance;
            if (trackedPath !== null) {
              mightBeOnTrackedPath = true;
            }
            if (traceUpdatesEnabled) {
              traceUpdatesForNodes.clear();
            }
            var isProfilingSupported = rootSupportsProfiling(root);
            if (isProfiling && isProfilingSupported) {
              currentCommitProfilingMetadata = {
                changeDescriptions: recordChangeDescriptions ? new Map() : null,
                durations: [],
                commitTime: renderer_getCurrentTime() - profilingStartTime,
                maxActualDuration: 0,
                priorityLevel:
                  priorityLevel == null
                    ? null
                    : formatPriorityLevel(priorityLevel),
                updaters: null,
                effectDuration: null,
                passiveEffectDuration: null,
              };
            }
            if (prevFiber !== null) {
              var wasMounted =
                prevFiber.memoizedState != null &&
                prevFiber.memoizedState.element != null &&
                prevFiber.memoizedState.isDehydrated !== true;
              var isMounted =
                current.memoizedState != null &&
                current.memoizedState.element != null &&
                current.memoizedState.isDehydrated !== true;
              if (!wasMounted && isMounted) {
                setRootPseudoKey(currentRoot.id, current);
                mountFiberRecursively(current, false);
              } else if (wasMounted && isMounted) {
                updateFiberRecursively(rootInstance, current, prevFiber, false);
              } else if (wasMounted && !isMounted) {
                unmountInstanceRecursively(rootInstance);
                removeRootPseudoKey(currentRoot.id);
                rootToFiberInstanceMap.delete(root);
              }
            } else {
              setRootPseudoKey(currentRoot.id, current);
              mountFiberRecursively(current, false);
            }
            if (isProfiling && isProfilingSupported) {
              if (!shouldBailoutWithPendingOperations()) {
                var commitProfilingMetadata =
                  rootToCommitProfilingMetadataMap.get(currentRoot.id);
                if (commitProfilingMetadata != null) {
                  commitProfilingMetadata.push(currentCommitProfilingMetadata);
                } else {
                  rootToCommitProfilingMetadataMap.set(currentRoot.id, [
                    currentCommitProfilingMetadata,
                  ]);
                }
              }
            }
            flushPendingEvents(root);
            needsToFlushComponentLogs = false;
            if (traceUpdatesEnabled) {
              hook.emit('traceUpdates', traceUpdatesForNodes);
            }
            currentRoot = null;
          }
          function getResourceInstance(fiber) {
            if (fiber.tag === HostHoistable) {
              var resource = fiber.memoizedState;
              if (
                renderer_typeof(resource) === 'object' &&
                resource !== null &&
                resource.instance != null
              ) {
                return resource.instance;
              }
            }
            return null;
          }
          function appendHostInstancesByDevToolsInstance(
            devtoolsInstance,
            hostInstances
          ) {
            if (devtoolsInstance.kind !== VIRTUAL_INSTANCE) {
              var _fiber4 = devtoolsInstance.data;
              appendHostInstancesByFiber(_fiber4, hostInstances);
              return;
            }
            for (
              var child = devtoolsInstance.firstChild;
              child !== null;
              child = child.nextSibling
            ) {
              appendHostInstancesByDevToolsInstance(child, hostInstances);
            }
          }
          function appendHostInstancesByFiber(fiber, hostInstances) {
            var node = fiber;
            while (true) {
              if (
                node.tag === HostComponent ||
                node.tag === HostText ||
                node.tag === HostSingleton ||
                node.tag === HostHoistable
              ) {
                var hostInstance = node.stateNode || getResourceInstance(node);
                if (hostInstance) {
                  hostInstances.push(hostInstance);
                }
              } else if (node.child) {
                node.child.return = node;
                node = node.child;
                continue;
              }
              if (node === fiber) {
                return;
              }
              while (!node.sibling) {
                if (!node.return || node.return === fiber) {
                  return;
                }
                node = node.return;
              }
              node.sibling.return = node.return;
              node = node.sibling;
            }
          }
          function findAllCurrentHostInstances(devtoolsInstance) {
            var hostInstances = [];
            appendHostInstancesByDevToolsInstance(
              devtoolsInstance,
              hostInstances
            );
            return hostInstances;
          }
          function findHostInstancesForElementID(id) {
            try {
              var devtoolsInstance = idToDevToolsInstanceMap.get(id);
              if (devtoolsInstance === undefined) {
                console.warn(
                  'Could not find DevToolsInstance with id "'.concat(id, '"')
                );
                return null;
              }
              return findAllCurrentHostInstances(devtoolsInstance);
            } catch (err) {
              return null;
            }
          }
          function getDisplayNameForElementID(id) {
            var devtoolsInstance = idToDevToolsInstanceMap.get(id);
            if (devtoolsInstance === undefined) {
              return null;
            }
            if (devtoolsInstance.kind === FIBER_INSTANCE) {
              return getDisplayNameForFiber(devtoolsInstance.data);
            } else {
              return devtoolsInstance.data.name || '';
            }
          }
          function getNearestMountedDOMNode(publicInstance) {
            var domNode = publicInstance;
            while (
              domNode &&
              !publicInstanceToDevToolsInstanceMap.has(domNode)
            ) {
              domNode = domNode.parentNode;
            }
            return domNode;
          }
          function getElementIDForHostInstance(publicInstance) {
            var instance =
              publicInstanceToDevToolsInstanceMap.get(publicInstance);
            if (instance !== undefined) {
              if (instance.kind === FILTERED_FIBER_INSTANCE) {
                return instance.parent.id;
              }
              return instance.id;
            }
            return null;
          }
          function getElementAttributeByPath(id, path) {
            if (isMostRecentlyInspectedElement(id)) {
              return utils_getInObject(mostRecentlyInspectedElement, path);
            }
            return;
          }
          function getElementSourceFunctionById(id) {
            var devtoolsInstance = idToDevToolsInstanceMap.get(id);
            if (devtoolsInstance === undefined) {
              console.warn(
                'Could not find DevToolsInstance with id "'.concat(id, '"')
              );
              return null;
            }
            if (devtoolsInstance.kind !== FIBER_INSTANCE) {
              return null;
            }
            var fiber = devtoolsInstance.data;
            var { elementType, tag, type } = fiber;
            switch (tag) {
              case ClassComponent:
              case IncompleteClassComponent:
              case IncompleteFunctionComponent:
              case IndeterminateComponent:
              case FunctionComponent:
                return type;
              case ForwardRef:
                return type.render;
              case MemoComponent:
              case SimpleMemoComponent:
                return elementType != null && elementType.type != null
                  ? elementType.type
                  : type;
              default:
                return null;
            }
          }
          function instanceToSerializedElement(instance) {
            if (instance.kind === FIBER_INSTANCE) {
              var _fiber5 = instance.data;
              return {
                displayName: getDisplayNameForFiber(_fiber5) || 'Anonymous',
                id: instance.id,
                key: _fiber5.key,
                type: getElementTypeForFiber(_fiber5),
              };
            } else {
              var componentInfo = instance.data;
              return {
                displayName: componentInfo.name || 'Anonymous',
                id: instance.id,
                key: componentInfo.key == null ? null : componentInfo.key,
                type: types_ElementTypeVirtual,
              };
            }
          }
          function getOwnersList(id) {
            var devtoolsInstance = idToDevToolsInstanceMap.get(id);
            if (devtoolsInstance === undefined) {
              console.warn(
                'Could not find DevToolsInstance with id "'.concat(id, '"')
              );
              return null;
            }
            var self2 = instanceToSerializedElement(devtoolsInstance);
            var owners = getOwnersListFromInstance(devtoolsInstance);
            if (owners === null) {
              return [self2];
            }
            owners.unshift(self2);
            owners.reverse();
            return owners;
          }
          function getOwnersListFromInstance(instance) {
            var owner = getUnfilteredOwner(instance.data);
            if (owner === null) {
              return null;
            }
            var owners = [];
            var parentInstance = instance.parent;
            while (parentInstance !== null && owner !== null) {
              var ownerInstance = findNearestOwnerInstance(
                parentInstance,
                owner
              );
              if (ownerInstance !== null) {
                owners.push(instanceToSerializedElement(ownerInstance));
                owner = getUnfilteredOwner(owner);
                parentInstance = ownerInstance.parent;
              } else {
                break;
              }
            }
            return owners;
          }
          function getUnfilteredOwner(owner) {
            if (owner == null) {
              return null;
            }
            if (typeof owner.tag === 'number') {
              var ownerFiber = owner;
              owner = ownerFiber._debugOwner;
            } else {
              var ownerInfo = owner;
              owner = ownerInfo.owner;
            }
            while (owner) {
              if (typeof owner.tag === 'number') {
                var _ownerFiber = owner;
                if (!shouldFilterFiber(_ownerFiber)) {
                  return _ownerFiber;
                }
                owner = _ownerFiber._debugOwner;
              } else {
                var _ownerInfo = owner;
                if (!shouldFilterVirtual(_ownerInfo, null)) {
                  return _ownerInfo;
                }
                owner = _ownerInfo.owner;
              }
            }
            return null;
          }
          function findNearestOwnerInstance(parentInstance, owner) {
            if (owner == null) {
              return null;
            }
            while (parentInstance !== null) {
              if (
                parentInstance.data === owner ||
                parentInstance.data === owner.alternate
              ) {
                if (parentInstance.kind === FILTERED_FIBER_INSTANCE) {
                  return null;
                }
                return parentInstance;
              }
              parentInstance = parentInstance.parent;
            }
            return null;
          }
          function getInstanceAndStyle(id) {
            var instance = null;
            var style = null;
            var devtoolsInstance = idToDevToolsInstanceMap.get(id);
            if (devtoolsInstance === undefined) {
              console.warn(
                'Could not find DevToolsInstance with id "'.concat(id, '"')
              );
              return {
                instance,
                style,
              };
            }
            if (devtoolsInstance.kind !== FIBER_INSTANCE) {
              return {
                instance,
                style,
              };
            }
            var fiber = devtoolsInstance.data;
            if (fiber !== null) {
              instance = fiber.stateNode;
              if (fiber.memoizedProps !== null) {
                style = fiber.memoizedProps.style;
              }
            }
            return {
              instance,
              style,
            };
          }
          function isErrorBoundary(fiber) {
            var { tag, type } = fiber;
            switch (tag) {
              case ClassComponent:
              case IncompleteClassComponent:
                var instance = fiber.stateNode;
                return (
                  typeof type.getDerivedStateFromError === 'function' ||
                  (instance !== null &&
                    typeof instance.componentDidCatch === 'function')
                );
              default:
                return false;
            }
          }
          function inspectElementRaw(id) {
            var devtoolsInstance = idToDevToolsInstanceMap.get(id);
            if (devtoolsInstance === undefined) {
              console.warn(
                'Could not find DevToolsInstance with id "'.concat(id, '"')
              );
              return null;
            }
            if (devtoolsInstance.kind === VIRTUAL_INSTANCE) {
              return inspectVirtualInstanceRaw(devtoolsInstance);
            }
            if (devtoolsInstance.kind === FIBER_INSTANCE) {
              return inspectFiberInstanceRaw(devtoolsInstance);
            }
            throw new Error('Unsupported instance kind');
          }
          function inspectFiberInstanceRaw(fiberInstance) {
            var fiber = fiberInstance.data;
            if (fiber == null) {
              return null;
            }
            var {
              stateNode,
              key,
              memoizedProps,
              memoizedState,
              dependencies,
              tag,
              type,
            } = fiber;
            var elementType = getElementTypeForFiber(fiber);
            var usesHooks =
              (tag === FunctionComponent ||
                tag === SimpleMemoComponent ||
                tag === ForwardRef) &&
              (!!memoizedState || !!dependencies);
            var showState = !usesHooks && tag !== CacheComponent;
            var typeSymbol = getTypeSymbol(type);
            var canViewSource = false;
            var context = null;
            if (
              tag === ClassComponent ||
              tag === FunctionComponent ||
              tag === IncompleteClassComponent ||
              tag === IncompleteFunctionComponent ||
              tag === IndeterminateComponent ||
              tag === MemoComponent ||
              tag === ForwardRef ||
              tag === SimpleMemoComponent
            ) {
              canViewSource = true;
              if (stateNode && stateNode.context != null) {
                var shouldHideContext =
                  elementType === types_ElementTypeClass &&
                  !(type.contextTypes || type.contextType);
                if (!shouldHideContext) {
                  context = stateNode.context;
                }
              }
            } else if (
              (typeSymbol === CONTEXT_NUMBER ||
                typeSymbol === CONTEXT_SYMBOL_STRING) &&
              !(type._context === undefined && type.Provider === type)
            ) {
              var consumerResolvedContext = type._context || type;
              context = consumerResolvedContext._currentValue || null;
              var _current = fiber.return;
              while (_current !== null) {
                var currentType = _current.type;
                var currentTypeSymbol = getTypeSymbol(currentType);
                if (
                  currentTypeSymbol === PROVIDER_NUMBER ||
                  currentTypeSymbol === PROVIDER_SYMBOL_STRING
                ) {
                  var providerResolvedContext =
                    currentType._context || currentType.context;
                  if (providerResolvedContext === consumerResolvedContext) {
                    context = _current.memoizedProps.value;
                    break;
                  }
                }
                _current = _current.return;
              }
            } else if (typeSymbol === CONSUMER_SYMBOL_STRING) {
              var _consumerResolvedContext = type._context;
              context = _consumerResolvedContext._currentValue || null;
              var _current2 = fiber.return;
              while (_current2 !== null) {
                var _currentType = _current2.type;
                var _currentTypeSymbol = getTypeSymbol(_currentType);
                if (_currentTypeSymbol === CONTEXT_SYMBOL_STRING) {
                  var _providerResolvedContext = _currentType;
                  if (_providerResolvedContext === _consumerResolvedContext) {
                    context = _current2.memoizedProps.value;
                    break;
                  }
                }
                _current2 = _current2.return;
              }
            }
            var hasLegacyContext = false;
            if (context !== null) {
              hasLegacyContext = !!type.contextTypes;
              context = {
                value: context,
              };
            }
            var owners = getOwnersListFromInstance(fiberInstance);
            var hooks = null;
            if (usesHooks) {
              var originalConsoleMethods = {};
              for (var method in console) {
                try {
                  originalConsoleMethods[method] = console[method];
                  console[method] = function () {};
                } catch (error) {}
              }
              try {
                hooks = (0, react_debug_tools.inspectHooksOfFiber)(
                  fiber,
                  getDispatcherRef(renderer)
                );
              } finally {
                for (var _method in originalConsoleMethods) {
                  try {
                    console[_method] = originalConsoleMethods[_method];
                  } catch (error) {}
                }
              }
            }
            var rootType = null;
            var current = fiber;
            var hasErrorBoundary = false;
            var hasSuspenseBoundary = false;
            while (current.return !== null) {
              var temp = current;
              current = current.return;
              if (temp.tag === SuspenseComponent) {
                hasSuspenseBoundary = true;
              } else if (isErrorBoundary(temp)) {
                hasErrorBoundary = true;
              }
            }
            var fiberRoot = current.stateNode;
            if (fiberRoot != null && fiberRoot._debugRootType !== null) {
              rootType = fiberRoot._debugRootType;
            }
            var isTimedOutSuspense =
              tag === SuspenseComponent && memoizedState !== null;
            var isErrored = false;
            if (isErrorBoundary(fiber)) {
              var DidCapture = 128;
              isErrored =
                (fiber.flags & DidCapture) !== 0 ||
                forceErrorForFibers.get(fiber) === true ||
                (fiber.alternate !== null &&
                  forceErrorForFibers.get(fiber.alternate) === true);
            }
            var plugins = {
              stylex: null,
            };
            if (enableStyleXFeatures) {
              if (
                memoizedProps != null &&
                memoizedProps.hasOwnProperty('xstyle')
              ) {
                plugins.stylex = getStyleXData(memoizedProps.xstyle);
              }
            }
            var source = null;
            if (canViewSource) {
              source = getSourceForFiberInstance(fiberInstance);
            }
            var componentLogsEntry = fiberToComponentLogsMap.get(fiber);
            if (componentLogsEntry === undefined && fiber.alternate !== null) {
              componentLogsEntry = fiberToComponentLogsMap.get(fiber.alternate);
            }
            var nativeTag = null;
            if (elementType === ElementTypeHostComponent) {
              nativeTag = getNativeTag(fiber.stateNode);
            }
            return {
              id: fiberInstance.id,
              canEditHooks: typeof overrideHookState === 'function',
              canEditFunctionProps: typeof overrideProps === 'function',
              canEditHooksAndDeletePaths:
                typeof overrideHookStateDeletePath === 'function',
              canEditHooksAndRenamePaths:
                typeof overrideHookStateRenamePath === 'function',
              canEditFunctionPropsDeletePaths:
                typeof overridePropsDeletePath === 'function',
              canEditFunctionPropsRenamePaths:
                typeof overridePropsRenamePath === 'function',
              canToggleError: supportsTogglingError && hasErrorBoundary,
              isErrored,
              canToggleSuspense:
                supportsTogglingSuspense &&
                hasSuspenseBoundary &&
                (!isTimedOutSuspense ||
                  forceFallbackForFibers.has(fiber) ||
                  (fiber.alternate !== null &&
                    forceFallbackForFibers.has(fiber.alternate))),
              canViewSource,
              source,
              hasLegacyContext,
              key: key != null ? key : null,
              type: elementType,
              context,
              hooks,
              props: memoizedProps,
              state: showState ? memoizedState : null,
              errors:
                componentLogsEntry === undefined
                  ? []
                  : Array.from(componentLogsEntry.errors.entries()),
              warnings:
                componentLogsEntry === undefined
                  ? []
                  : Array.from(componentLogsEntry.warnings.entries()),
              owners,
              rootType,
              rendererPackageName: renderer.rendererPackageName,
              rendererVersion: renderer.version,
              plugins,
              nativeTag,
            };
          }
          function inspectVirtualInstanceRaw(virtualInstance) {
            var canViewSource = true;
            var source = getSourceForInstance(virtualInstance);
            var componentInfo = virtualInstance.data;
            var key =
              typeof componentInfo.key === 'string' ? componentInfo.key : null;
            var props =
              componentInfo.props == null ? null : componentInfo.props;
            var owners = getOwnersListFromInstance(virtualInstance);
            var rootType = null;
            var hasErrorBoundary = false;
            var hasSuspenseBoundary = false;
            var nearestFiber = getNearestFiber(virtualInstance);
            if (nearestFiber !== null) {
              var current = nearestFiber;
              while (current.return !== null) {
                var temp = current;
                current = current.return;
                if (temp.tag === SuspenseComponent) {
                  hasSuspenseBoundary = true;
                } else if (isErrorBoundary(temp)) {
                  hasErrorBoundary = true;
                }
              }
              var fiberRoot = current.stateNode;
              if (fiberRoot != null && fiberRoot._debugRootType !== null) {
                rootType = fiberRoot._debugRootType;
              }
            }
            var plugins = {
              stylex: null,
            };
            var componentLogsEntry =
              componentInfoToComponentLogsMap.get(componentInfo);
            return {
              id: virtualInstance.id,
              canEditHooks: false,
              canEditFunctionProps: false,
              canEditHooksAndDeletePaths: false,
              canEditHooksAndRenamePaths: false,
              canEditFunctionPropsDeletePaths: false,
              canEditFunctionPropsRenamePaths: false,
              canToggleError: supportsTogglingError && hasErrorBoundary,
              isErrored: false,
              canToggleSuspense:
                supportsTogglingSuspense && hasSuspenseBoundary,
              canViewSource,
              source,
              hasLegacyContext: false,
              key,
              type: types_ElementTypeVirtual,
              context: null,
              hooks: null,
              props,
              state: null,
              errors:
                componentLogsEntry === undefined
                  ? []
                  : Array.from(componentLogsEntry.errors.entries()),
              warnings:
                componentLogsEntry === undefined
                  ? []
                  : Array.from(componentLogsEntry.warnings.entries()),
              owners,
              rootType,
              rendererPackageName: renderer.rendererPackageName,
              rendererVersion: renderer.version,
              plugins,
              nativeTag: null,
            };
          }
          var mostRecentlyInspectedElement = null;
          var hasElementUpdatedSinceLastInspected = false;
          var currentlyInspectedPaths = {};
          function isMostRecentlyInspectedElement(id) {
            return (
              mostRecentlyInspectedElement !== null &&
              mostRecentlyInspectedElement.id === id
            );
          }
          function isMostRecentlyInspectedElementCurrent(id) {
            return (
              isMostRecentlyInspectedElement(id) &&
              !hasElementUpdatedSinceLastInspected
            );
          }
          function mergeInspectedPaths(path) {
            var current = currentlyInspectedPaths;
            path.forEach(function (key) {
              if (!current[key]) {
                current[key] = {};
              }
              current = current[key];
            });
          }
          function createIsPathAllowed(key, secondaryCategory) {
            return function isPathAllowed(path) {
              switch (secondaryCategory) {
                case 'hooks':
                  if (path.length === 1) {
                    return true;
                  }
                  if (
                    path[path.length - 2] === 'hookSource' &&
                    path[path.length - 1] === 'fileName'
                  ) {
                    return true;
                  }
                  if (
                    path[path.length - 1] === 'subHooks' ||
                    path[path.length - 2] === 'subHooks'
                  ) {
                    return true;
                  }
                  break;
                default:
                  break;
              }
              var current =
                key === null
                  ? currentlyInspectedPaths
                  : currentlyInspectedPaths[key];
              if (!current) {
                return false;
              }
              for (var i = 0; i < path.length; i++) {
                current = current[path[i]];
                if (!current) {
                  return false;
                }
              }
              return true;
            };
          }
          function updateSelectedElement(inspectedElement) {
            var { hooks, id, props } = inspectedElement;
            var devtoolsInstance = idToDevToolsInstanceMap.get(id);
            if (devtoolsInstance === undefined) {
              console.warn(
                'Could not find DevToolsInstance with id "'.concat(id, '"')
              );
              return;
            }
            if (devtoolsInstance.kind !== FIBER_INSTANCE) {
              return;
            }
            var fiber = devtoolsInstance.data;
            var { elementType, stateNode, tag, type } = fiber;
            switch (tag) {
              case ClassComponent:
              case IncompleteClassComponent:
              case IndeterminateComponent:
                global2.$r = stateNode;
                break;
              case IncompleteFunctionComponent:
              case FunctionComponent:
                global2.$r = {
                  hooks,
                  props,
                  type,
                };
                break;
              case ForwardRef:
                global2.$r = {
                  hooks,
                  props,
                  type: type.render,
                };
                break;
              case MemoComponent:
              case SimpleMemoComponent:
                global2.$r = {
                  hooks,
                  props,
                  type:
                    elementType != null && elementType.type != null
                      ? elementType.type
                      : type,
                };
                break;
              default:
                global2.$r = null;
                break;
            }
          }
          function storeAsGlobal(id, path, count) {
            if (isMostRecentlyInspectedElement(id)) {
              var value = utils_getInObject(mostRecentlyInspectedElement, path);
              var key = '$reactTemp'.concat(count);
              window[key] = value;
              console.log(key);
              console.log(value);
            }
          }
          function getSerializedElementValueByPath(id, path) {
            if (isMostRecentlyInspectedElement(id)) {
              var valueToCopy = utils_getInObject(
                mostRecentlyInspectedElement,
                path
              );
              return serializeToString(valueToCopy);
            }
          }
          function inspectElement(requestID, id, path, forceFullData) {
            if (path !== null) {
              mergeInspectedPaths(path);
            }
            if (isMostRecentlyInspectedElement(id) && !forceFullData) {
              if (!hasElementUpdatedSinceLastInspected) {
                if (path !== null) {
                  var secondaryCategory = null;
                  if (path[0] === 'hooks') {
                    secondaryCategory = 'hooks';
                  }
                  return {
                    id,
                    responseID: requestID,
                    type: 'hydrated-path',
                    path,
                    value: cleanForBridge(
                      utils_getInObject(mostRecentlyInspectedElement, path),
                      createIsPathAllowed(null, secondaryCategory),
                      path
                    ),
                  };
                } else {
                  return {
                    id,
                    responseID: requestID,
                    type: 'no-change',
                  };
                }
              }
            } else {
              currentlyInspectedPaths = {};
            }
            hasElementUpdatedSinceLastInspected = false;
            try {
              mostRecentlyInspectedElement = inspectElementRaw(id);
            } catch (error) {
              if (error.name === 'ReactDebugToolsRenderError') {
                var message = 'Error rendering inspected element.';
                var stack;
                console.error(
                  message +
                    `

`,
                  error
                );
                if (error.cause != null) {
                  var componentName = getDisplayNameForElementID(id);
                  console.error(
                    'React DevTools encountered an error while trying to inspect hooks. ' +
                      'This is most likely caused by an error in current inspected component' +
                      (componentName != null
                        ? ': "'.concat(componentName, '".')
                        : '.') +
                      `
The error thrown in the component is: 

`,
                    error.cause
                  );
                  if (error.cause instanceof Error) {
                    message = error.cause.message || message;
                    stack = error.cause.stack;
                  }
                }
                return {
                  type: 'error',
                  errorType: 'user',
                  id,
                  responseID: requestID,
                  message,
                  stack,
                };
              }
              if (error.name === 'ReactDebugToolsUnsupportedHookError') {
                return {
                  type: 'error',
                  errorType: 'unknown-hook',
                  id,
                  responseID: requestID,
                  message:
                    'Unsupported hook in the react-debug-tools package: ' +
                    error.message,
                };
              }
              console.error(
                `Error inspecting element.

`,
                error
              );
              return {
                type: 'error',
                errorType: 'uncaught',
                id,
                responseID: requestID,
                message: error.message,
                stack: error.stack,
              };
            }
            if (mostRecentlyInspectedElement === null) {
              return {
                id,
                responseID: requestID,
                type: 'not-found',
              };
            }
            updateSelectedElement(mostRecentlyInspectedElement);
            var cleanedInspectedElement = renderer_objectSpread(
              {},
              mostRecentlyInspectedElement
            );
            cleanedInspectedElement.context = cleanForBridge(
              cleanedInspectedElement.context,
              createIsPathAllowed('context', null)
            );
            cleanedInspectedElement.hooks = cleanForBridge(
              cleanedInspectedElement.hooks,
              createIsPathAllowed('hooks', 'hooks')
            );
            cleanedInspectedElement.props = cleanForBridge(
              cleanedInspectedElement.props,
              createIsPathAllowed('props', null)
            );
            cleanedInspectedElement.state = cleanForBridge(
              cleanedInspectedElement.state,
              createIsPathAllowed('state', null)
            );
            return {
              id,
              responseID: requestID,
              type: 'full-data',
              value: cleanedInspectedElement,
            };
          }
          function logElementToConsole(id) {
            var result = isMostRecentlyInspectedElementCurrent(id)
              ? mostRecentlyInspectedElement
              : inspectElementRaw(id);
            if (result === null) {
              console.warn(
                'Could not find DevToolsInstance with id "'.concat(id, '"')
              );
              return;
            }
            var displayName = getDisplayNameForElementID(id);
            var supportsGroup = typeof console.groupCollapsed === 'function';
            if (supportsGroup) {
              console.groupCollapsed(
                '[Click to expand] %c<'.concat(
                  displayName || 'Component',
                  ' />'
                ),
                'color: var(--dom-tag-name-color); font-weight: normal;'
              );
            }
            if (result.props !== null) {
              console.log('Props:', result.props);
            }
            if (result.state !== null) {
              console.log('State:', result.state);
            }
            if (result.hooks !== null) {
              console.log('Hooks:', result.hooks);
            }
            var hostInstances = findHostInstancesForElementID(id);
            if (hostInstances !== null) {
              console.log('Nodes:', hostInstances);
            }
            if (window.chrome || /firefox/i.test(navigator.userAgent)) {
              console.log(
                'Right-click any value to save it as a global variable for further inspection.'
              );
            }
            if (supportsGroup) {
              console.groupEnd();
            }
          }
          function deletePath(type, id, hookID, path) {
            var devtoolsInstance = idToDevToolsInstanceMap.get(id);
            if (devtoolsInstance === undefined) {
              console.warn(
                'Could not find DevToolsInstance with id "'.concat(id, '"')
              );
              return;
            }
            if (devtoolsInstance.kind !== FIBER_INSTANCE) {
              return;
            }
            var fiber = devtoolsInstance.data;
            if (fiber !== null) {
              var instance = fiber.stateNode;
              switch (type) {
                case 'context':
                  path = path.slice(1);
                  switch (fiber.tag) {
                    case ClassComponent:
                      if (path.length === 0) {
                      } else {
                        deletePathInObject(instance.context, path);
                      }
                      instance.forceUpdate();
                      break;
                    case FunctionComponent:
                      break;
                  }
                  break;
                case 'hooks':
                  if (typeof overrideHookStateDeletePath === 'function') {
                    overrideHookStateDeletePath(fiber, hookID, path);
                  }
                  break;
                case 'props':
                  if (instance === null) {
                    if (typeof overridePropsDeletePath === 'function') {
                      overridePropsDeletePath(fiber, path);
                    }
                  } else {
                    fiber.pendingProps = copyWithDelete(instance.props, path);
                    instance.forceUpdate();
                  }
                  break;
                case 'state':
                  deletePathInObject(instance.state, path);
                  instance.forceUpdate();
                  break;
              }
            }
          }
          function renamePath(type, id, hookID, oldPath, newPath) {
            var devtoolsInstance = idToDevToolsInstanceMap.get(id);
            if (devtoolsInstance === undefined) {
              console.warn(
                'Could not find DevToolsInstance with id "'.concat(id, '"')
              );
              return;
            }
            if (devtoolsInstance.kind !== FIBER_INSTANCE) {
              return;
            }
            var fiber = devtoolsInstance.data;
            if (fiber !== null) {
              var instance = fiber.stateNode;
              switch (type) {
                case 'context':
                  oldPath = oldPath.slice(1);
                  newPath = newPath.slice(1);
                  switch (fiber.tag) {
                    case ClassComponent:
                      if (oldPath.length === 0) {
                      } else {
                        renamePathInObject(instance.context, oldPath, newPath);
                      }
                      instance.forceUpdate();
                      break;
                    case FunctionComponent:
                      break;
                  }
                  break;
                case 'hooks':
                  if (typeof overrideHookStateRenamePath === 'function') {
                    overrideHookStateRenamePath(
                      fiber,
                      hookID,
                      oldPath,
                      newPath
                    );
                  }
                  break;
                case 'props':
                  if (instance === null) {
                    if (typeof overridePropsRenamePath === 'function') {
                      overridePropsRenamePath(fiber, oldPath, newPath);
                    }
                  } else {
                    fiber.pendingProps = copyWithRename(
                      instance.props,
                      oldPath,
                      newPath
                    );
                    instance.forceUpdate();
                  }
                  break;
                case 'state':
                  renamePathInObject(instance.state, oldPath, newPath);
                  instance.forceUpdate();
                  break;
              }
            }
          }
          function overrideValueAtPath(type, id, hookID, path, value) {
            var devtoolsInstance = idToDevToolsInstanceMap.get(id);
            if (devtoolsInstance === undefined) {
              console.warn(
                'Could not find DevToolsInstance with id "'.concat(id, '"')
              );
              return;
            }
            if (devtoolsInstance.kind !== FIBER_INSTANCE) {
              return;
            }
            var fiber = devtoolsInstance.data;
            if (fiber !== null) {
              var instance = fiber.stateNode;
              switch (type) {
                case 'context':
                  path = path.slice(1);
                  switch (fiber.tag) {
                    case ClassComponent:
                      if (path.length === 0) {
                        instance.context = value;
                      } else {
                        utils_setInObject(instance.context, path, value);
                      }
                      instance.forceUpdate();
                      break;
                    case FunctionComponent:
                      break;
                  }
                  break;
                case 'hooks':
                  if (typeof overrideHookState === 'function') {
                    overrideHookState(fiber, hookID, path, value);
                  }
                  break;
                case 'props':
                  switch (fiber.tag) {
                    case ClassComponent:
                      fiber.pendingProps = copyWithSet(
                        instance.props,
                        path,
                        value
                      );
                      instance.forceUpdate();
                      break;
                    default:
                      if (typeof overrideProps === 'function') {
                        overrideProps(fiber, path, value);
                      }
                      break;
                  }
                  break;
                case 'state':
                  switch (fiber.tag) {
                    case ClassComponent:
                      utils_setInObject(instance.state, path, value);
                      instance.forceUpdate();
                      break;
                  }
                  break;
              }
            }
          }
          var currentCommitProfilingMetadata = null;
          var displayNamesByRootID = null;
          var initialTreeBaseDurationsMap = null;
          var isProfiling = false;
          var profilingStartTime = 0;
          var recordChangeDescriptions = false;
          var recordTimeline = false;
          var rootToCommitProfilingMetadataMap = null;
          function getProfilingData() {
            var dataForRoots = [];
            if (rootToCommitProfilingMetadataMap === null) {
              throw Error(
                'getProfilingData() called before any profiling data was recorded'
              );
            }
            rootToCommitProfilingMetadataMap.forEach(
              function (commitProfilingMetadata, rootID) {
                var commitData = [];
                var displayName =
                  (displayNamesByRootID !== null &&
                    displayNamesByRootID.get(rootID)) ||
                  'Unknown';
                var initialTreeBaseDurations =
                  (initialTreeBaseDurationsMap !== null &&
                    initialTreeBaseDurationsMap.get(rootID)) ||
                  [];
                commitProfilingMetadata.forEach(
                  function (commitProfilingData, commitIndex) {
                    var {
                      changeDescriptions,
                      durations,
                      effectDuration,
                      maxActualDuration,
                      passiveEffectDuration,
                      priorityLevel,
                      commitTime,
                      updaters,
                    } = commitProfilingData;
                    var fiberActualDurations = [];
                    var fiberSelfDurations = [];
                    for (var i = 0; i < durations.length; i += 3) {
                      var fiberID = durations[i];
                      fiberActualDurations.push([
                        fiberID,
                        formatDurationToMicrosecondsGranularity(
                          durations[i + 1]
                        ),
                      ]);
                      fiberSelfDurations.push([
                        fiberID,
                        formatDurationToMicrosecondsGranularity(
                          durations[i + 2]
                        ),
                      ]);
                    }
                    commitData.push({
                      changeDescriptions:
                        changeDescriptions !== null
                          ? Array.from(changeDescriptions.entries())
                          : null,
                      duration:
                        formatDurationToMicrosecondsGranularity(
                          maxActualDuration
                        ),
                      effectDuration:
                        effectDuration !== null
                          ? formatDurationToMicrosecondsGranularity(
                              effectDuration
                            )
                          : null,
                      fiberActualDurations,
                      fiberSelfDurations,
                      passiveEffectDuration:
                        passiveEffectDuration !== null
                          ? formatDurationToMicrosecondsGranularity(
                              passiveEffectDuration
                            )
                          : null,
                      priorityLevel,
                      timestamp: commitTime,
                      updaters,
                    });
                  }
                );
                dataForRoots.push({
                  commitData,
                  displayName,
                  initialTreeBaseDurations,
                  rootID,
                });
              }
            );
            var timelineData = null;
            if (typeof getTimelineData === 'function') {
              var currentTimelineData = getTimelineData();
              if (currentTimelineData) {
                var {
                    batchUIDToMeasuresMap,
                    internalModuleSourceToRanges,
                    laneToLabelMap,
                    laneToReactMeasureMap,
                  } = currentTimelineData,
                  rest = _objectWithoutProperties(currentTimelineData, [
                    'batchUIDToMeasuresMap',
                    'internalModuleSourceToRanges',
                    'laneToLabelMap',
                    'laneToReactMeasureMap',
                  ]);
                timelineData = renderer_objectSpread(
                  renderer_objectSpread({}, rest),
                  {},
                  {
                    batchUIDToMeasuresKeyValueArray: Array.from(
                      batchUIDToMeasuresMap.entries()
                    ),
                    internalModuleSourceToRanges: Array.from(
                      internalModuleSourceToRanges.entries()
                    ),
                    laneToLabelKeyValueArray: Array.from(
                      laneToLabelMap.entries()
                    ),
                    laneToReactMeasureKeyValueArray: Array.from(
                      laneToReactMeasureMap.entries()
                    ),
                  }
                );
              }
            }
            return {
              dataForRoots,
              rendererID,
              timelineData,
            };
          }
          function snapshotTreeBaseDurations(instance, target) {
            if (instance.kind !== FILTERED_FIBER_INSTANCE) {
              target.push([instance.id, instance.treeBaseDuration]);
            }
            for (
              var child = instance.firstChild;
              child !== null;
              child = child.nextSibling
            ) {
              snapshotTreeBaseDurations(child, target);
            }
          }
          function startProfiling(
            shouldRecordChangeDescriptions,
            shouldRecordTimeline
          ) {
            if (isProfiling) {
              return;
            }
            recordChangeDescriptions = shouldRecordChangeDescriptions;
            recordTimeline = shouldRecordTimeline;
            displayNamesByRootID = new Map();
            initialTreeBaseDurationsMap = new Map();
            hook.getFiberRoots(rendererID).forEach(function (root) {
              var rootInstance = rootToFiberInstanceMap.get(root);
              if (rootInstance === undefined) {
                throw new Error(
                  'Expected the root instance to already exist when starting profiling'
                );
              }
              var rootID = rootInstance.id;
              displayNamesByRootID.set(
                rootID,
                getDisplayNameForRoot(root.current)
              );
              var initialTreeBaseDurations = [];
              snapshotTreeBaseDurations(rootInstance, initialTreeBaseDurations);
              initialTreeBaseDurationsMap.set(rootID, initialTreeBaseDurations);
            });
            isProfiling = true;
            profilingStartTime = renderer_getCurrentTime();
            rootToCommitProfilingMetadataMap = new Map();
            if (toggleProfilingStatus !== null) {
              toggleProfilingStatus(true, recordTimeline);
            }
          }
          function stopProfiling() {
            isProfiling = false;
            recordChangeDescriptions = false;
            if (toggleProfilingStatus !== null) {
              toggleProfilingStatus(false, recordTimeline);
            }
            recordTimeline = false;
          }
          if (shouldStartProfilingNow) {
            startProfiling(
              profilingSettings.recordChangeDescriptions,
              profilingSettings.recordTimeline
            );
          }
          function getNearestFiber(devtoolsInstance) {
            if (devtoolsInstance.kind === VIRTUAL_INSTANCE) {
              var inst = devtoolsInstance;
              while (inst.kind === VIRTUAL_INSTANCE) {
                if (inst.firstChild === null) {
                  return null;
                }
                inst = inst.firstChild;
              }
              return inst.data.return;
            } else {
              return devtoolsInstance.data;
            }
          }
          function shouldErrorFiberAlwaysNull() {
            return null;
          }
          var forceErrorForFibers = new Map();
          function shouldErrorFiberAccordingToMap(fiber) {
            if (typeof setErrorHandler !== 'function') {
              throw new Error(
                'Expected overrideError() to not get called for earlier React versions.'
              );
            }
            var status = forceErrorForFibers.get(fiber);
            if (status === false) {
              forceErrorForFibers.delete(fiber);
              if (forceErrorForFibers.size === 0) {
                setErrorHandler(shouldErrorFiberAlwaysNull);
              }
              return false;
            }
            if (status === undefined && fiber.alternate !== null) {
              status = forceErrorForFibers.get(fiber.alternate);
              if (status === false) {
                forceErrorForFibers.delete(fiber.alternate);
                if (forceErrorForFibers.size === 0) {
                  setErrorHandler(shouldErrorFiberAlwaysNull);
                }
              }
            }
            if (status === undefined) {
              return false;
            }
            return status;
          }
          function overrideError(id, forceError) {
            if (
              typeof setErrorHandler !== 'function' ||
              typeof scheduleUpdate !== 'function'
            ) {
              throw new Error(
                'Expected overrideError() to not get called for earlier React versions.'
              );
            }
            var devtoolsInstance = idToDevToolsInstanceMap.get(id);
            if (devtoolsInstance === undefined) {
              return;
            }
            var nearestFiber = getNearestFiber(devtoolsInstance);
            if (nearestFiber === null) {
              return;
            }
            var fiber = nearestFiber;
            while (!isErrorBoundary(fiber)) {
              if (fiber.return === null) {
                return;
              }
              fiber = fiber.return;
            }
            forceErrorForFibers.set(fiber, forceError);
            if (fiber.alternate !== null) {
              forceErrorForFibers.delete(fiber.alternate);
            }
            if (forceErrorForFibers.size === 1) {
              setErrorHandler(shouldErrorFiberAccordingToMap);
            }
            scheduleUpdate(fiber);
          }
          function shouldSuspendFiberAlwaysFalse() {
            return false;
          }
          var forceFallbackForFibers = new Set();
          function shouldSuspendFiberAccordingToSet(fiber) {
            return (
              forceFallbackForFibers.has(fiber) ||
              (fiber.alternate !== null &&
                forceFallbackForFibers.has(fiber.alternate))
            );
          }
          function overrideSuspense(id, forceFallback) {
            if (
              typeof setSuspenseHandler !== 'function' ||
              typeof scheduleUpdate !== 'function'
            ) {
              throw new Error(
                'Expected overrideSuspense() to not get called for earlier React versions.'
              );
            }
            var devtoolsInstance = idToDevToolsInstanceMap.get(id);
            if (devtoolsInstance === undefined) {
              return;
            }
            var nearestFiber = getNearestFiber(devtoolsInstance);
            if (nearestFiber === null) {
              return;
            }
            var fiber = nearestFiber;
            while (fiber.tag !== SuspenseComponent) {
              if (fiber.return === null) {
                return;
              }
              fiber = fiber.return;
            }
            if (fiber.alternate !== null) {
              forceFallbackForFibers.delete(fiber.alternate);
            }
            if (forceFallback) {
              forceFallbackForFibers.add(fiber);
              if (forceFallbackForFibers.size === 1) {
                setSuspenseHandler(shouldSuspendFiberAccordingToSet);
              }
            } else {
              forceFallbackForFibers.delete(fiber);
              if (forceFallbackForFibers.size === 0) {
                setSuspenseHandler(shouldSuspendFiberAlwaysFalse);
              }
            }
            scheduleUpdate(fiber);
          }
          var trackedPath = null;
          var trackedPathMatchFiber = null;
          var trackedPathMatchInstance = null;
          var trackedPathMatchDepth = -1;
          var mightBeOnTrackedPath = false;
          function setTrackedPath(path) {
            if (path === null) {
              trackedPathMatchFiber = null;
              trackedPathMatchInstance = null;
              trackedPathMatchDepth = -1;
              mightBeOnTrackedPath = false;
            }
            trackedPath = path;
          }
          function updateTrackedPathStateBeforeMount(fiber, fiberInstance) {
            if (trackedPath === null || !mightBeOnTrackedPath) {
              return false;
            }
            var returnFiber = fiber.return;
            var returnAlternate =
              returnFiber !== null ? returnFiber.alternate : null;
            if (
              trackedPathMatchFiber === returnFiber ||
              (trackedPathMatchFiber === returnAlternate &&
                returnAlternate !== null)
            ) {
              var actualFrame = getPathFrame(fiber);
              var expectedFrame = trackedPath[trackedPathMatchDepth + 1];
              if (expectedFrame === undefined) {
                throw new Error('Expected to see a frame at the next depth.');
              }
              if (
                actualFrame.index === expectedFrame.index &&
                actualFrame.key === expectedFrame.key &&
                actualFrame.displayName === expectedFrame.displayName
              ) {
                trackedPathMatchFiber = fiber;
                if (
                  fiberInstance !== null &&
                  fiberInstance.kind === FIBER_INSTANCE
                ) {
                  trackedPathMatchInstance = fiberInstance;
                }
                trackedPathMatchDepth++;
                if (trackedPathMatchDepth === trackedPath.length - 1) {
                  mightBeOnTrackedPath = false;
                } else {
                  mightBeOnTrackedPath = true;
                }
                return false;
              }
            }
            if (trackedPathMatchFiber === null && fiberInstance === null) {
              return true;
            }
            mightBeOnTrackedPath = false;
            return true;
          }
          function updateVirtualTrackedPathStateBeforeMount(
            virtualInstance,
            parentInstance
          ) {
            if (trackedPath === null || !mightBeOnTrackedPath) {
              return false;
            }
            if (trackedPathMatchInstance === parentInstance) {
              var actualFrame = getVirtualPathFrame(virtualInstance);
              var expectedFrame = trackedPath[trackedPathMatchDepth + 1];
              if (expectedFrame === undefined) {
                throw new Error('Expected to see a frame at the next depth.');
              }
              if (
                actualFrame.index === expectedFrame.index &&
                actualFrame.key === expectedFrame.key &&
                actualFrame.displayName === expectedFrame.displayName
              ) {
                trackedPathMatchFiber = null;
                trackedPathMatchInstance = virtualInstance;
                trackedPathMatchDepth++;
                if (trackedPathMatchDepth === trackedPath.length - 1) {
                  mightBeOnTrackedPath = false;
                } else {
                  mightBeOnTrackedPath = true;
                }
                return false;
              }
            }
            if (trackedPathMatchFiber !== null) {
              return true;
            }
            mightBeOnTrackedPath = false;
            return true;
          }
          function updateTrackedPathStateAfterMount(
            mightSiblingsBeOnTrackedPath
          ) {
            mightBeOnTrackedPath = mightSiblingsBeOnTrackedPath;
          }
          var rootPseudoKeys = new Map();
          var rootDisplayNameCounter = new Map();
          function setRootPseudoKey(id, fiber) {
            var name = getDisplayNameForRoot(fiber);
            var counter = rootDisplayNameCounter.get(name) || 0;
            rootDisplayNameCounter.set(name, counter + 1);
            var pseudoKey = ''.concat(name, ':').concat(counter);
            rootPseudoKeys.set(id, pseudoKey);
          }
          function removeRootPseudoKey(id) {
            var pseudoKey = rootPseudoKeys.get(id);
            if (pseudoKey === undefined) {
              throw new Error('Expected root pseudo key to be known.');
            }
            var name = pseudoKey.slice(0, pseudoKey.lastIndexOf(':'));
            var counter = rootDisplayNameCounter.get(name);
            if (counter === undefined) {
              throw new Error('Expected counter to be known.');
            }
            if (counter > 1) {
              rootDisplayNameCounter.set(name, counter - 1);
            } else {
              rootDisplayNameCounter.delete(name);
            }
            rootPseudoKeys.delete(id);
          }
          function getDisplayNameForRoot(fiber) {
            var preferredDisplayName = null;
            var fallbackDisplayName = null;
            var child = fiber.child;
            for (var i = 0; i < 3; i++) {
              if (child === null) {
                break;
              }
              var displayName = getDisplayNameForFiber(child);
              if (displayName !== null) {
                if (typeof child.type === 'function') {
                  preferredDisplayName = displayName;
                } else if (fallbackDisplayName === null) {
                  fallbackDisplayName = displayName;
                }
              }
              if (preferredDisplayName !== null) {
                break;
              }
              child = child.child;
            }
            return preferredDisplayName || fallbackDisplayName || 'Anonymous';
          }
          function getPathFrame(fiber) {
            var key = fiber.key;
            var displayName = getDisplayNameForFiber(fiber);
            var index = fiber.index;
            switch (fiber.tag) {
              case HostRoot:
                var rootInstance = rootToFiberInstanceMap.get(fiber.stateNode);
                if (rootInstance === undefined) {
                  throw new Error(
                    'Expected the root instance to exist when computing a path'
                  );
                }
                var pseudoKey = rootPseudoKeys.get(rootInstance.id);
                if (pseudoKey === undefined) {
                  throw new Error(
                    'Expected mounted root to have known pseudo key.'
                  );
                }
                displayName = pseudoKey;
                break;
              case HostComponent:
                displayName = fiber.type;
                break;
              default:
                break;
            }
            return {
              displayName,
              key,
              index,
            };
          }
          function getVirtualPathFrame(virtualInstance) {
            return {
              displayName: virtualInstance.data.name || '',
              key:
                virtualInstance.data.key == null
                  ? null
                  : virtualInstance.data.key,
              index: -1,
            };
          }
          function getPathForElement(id) {
            var devtoolsInstance = idToDevToolsInstanceMap.get(id);
            if (devtoolsInstance === undefined) {
              return null;
            }
            var keyPath = [];
            var inst = devtoolsInstance;
            while (inst.kind === VIRTUAL_INSTANCE) {
              keyPath.push(getVirtualPathFrame(inst));
              if (inst.parent === null) {
                return null;
              }
              inst = inst.parent;
            }
            var fiber = inst.data;
            while (fiber !== null) {
              keyPath.push(getPathFrame(fiber));
              fiber = fiber.return;
            }
            keyPath.reverse();
            return keyPath;
          }
          function getBestMatchForTrackedPath() {
            if (trackedPath === null) {
              return null;
            }
            if (trackedPathMatchInstance === null) {
              return null;
            }
            return {
              id: trackedPathMatchInstance.id,
              isFullMatch: trackedPathMatchDepth === trackedPath.length - 1,
            };
          }
          var formatPriorityLevel = function formatPriorityLevel(
            priorityLevel
          ) {
            if (priorityLevel == null) {
              return 'Unknown';
            }
            switch (priorityLevel) {
              case ImmediatePriority:
                return 'Immediate';
              case UserBlockingPriority:
                return 'User-Blocking';
              case NormalPriority:
                return 'Normal';
              case LowPriority:
                return 'Low';
              case IdlePriority:
                return 'Idle';
              case NoPriority:
              default:
                return 'Unknown';
            }
          };
          function setTraceUpdatesEnabled(isEnabled2) {
            traceUpdatesEnabled = isEnabled2;
          }
          function hasElementWithId(id) {
            return idToDevToolsInstanceMap.has(id);
          }
          function getSourceForFiberInstance(fiberInstance) {
            var ownerSource = getSourceForInstance(fiberInstance);
            if (ownerSource !== null) {
              return ownerSource;
            }
            var dispatcherRef = getDispatcherRef(renderer);
            var stackFrame =
              dispatcherRef == null
                ? null
                : getSourceLocationByFiber(
                    ReactTypeOfWork,
                    fiberInstance.data,
                    dispatcherRef
                  );
            if (stackFrame === null) {
              return null;
            }
            var source = parseSourceFromComponentStack(stackFrame);
            fiberInstance.source = source;
            return source;
          }
          function getSourceForInstance(instance) {
            var unresolvedSource = instance.source;
            if (unresolvedSource === null) {
              return null;
            }
            if (instance.kind === VIRTUAL_INSTANCE) {
              var debugLocation = instance.data.debugLocation;
              if (debugLocation != null) {
                unresolvedSource = debugLocation;
              }
            }
            if (renderer_isError(unresolvedSource)) {
              return (instance.source =
                parseSourceFromOwnerStack(unresolvedSource));
            }
            if (typeof unresolvedSource === 'string') {
              var idx = unresolvedSource.lastIndexOf(`
`);
              var lastLine =
                idx === -1 ? unresolvedSource : unresolvedSource.slice(idx + 1);
              return (instance.source =
                parseSourceFromComponentStack(lastLine));
            }
            return unresolvedSource;
          }
          var internalMcpFunctions = {};
          if (false) {
          }
          return renderer_objectSpread(
            {
              cleanup,
              clearErrorsAndWarnings,
              clearErrorsForElementID,
              clearWarningsForElementID,
              getSerializedElementValueByPath,
              deletePath,
              findHostInstancesForElementID,
              flushInitialOperations,
              getBestMatchForTrackedPath,
              getDisplayNameForElementID,
              getNearestMountedDOMNode,
              getElementIDForHostInstance,
              getInstanceAndStyle,
              getOwnersList,
              getPathForElement,
              getProfilingData,
              handleCommitFiberRoot,
              handleCommitFiberUnmount,
              handlePostCommitFiberRoot,
              hasElementWithId,
              inspectElement,
              logElementToConsole,
              getComponentStack,
              getElementAttributeByPath,
              getElementSourceFunctionById,
              onErrorOrWarning,
              overrideError,
              overrideSuspense,
              overrideValueAtPath,
              renamePath,
              renderer,
              setTraceUpdatesEnabled,
              setTrackedPath,
              startProfiling,
              stopProfiling,
              storeAsGlobal,
              updateComponentFilters,
              getEnvironmentNames,
            },
            internalMcpFunctions
          );
        }
        function decorate(object, attr, fn) {
          var old = object[attr];
          object[attr] = function (instance) {
            return fn.call(this, old, arguments);
          };
          return old;
        }
        function decorateMany(source, fns) {
          var olds = {};
          for (var name in fns) {
            olds[name] = decorate(source, name, fns[name]);
          }
          return olds;
        }
        function restoreMany(source, olds) {
          for (var name in olds) {
            source[name] = olds[name];
          }
        }
        function forceUpdate(instance) {
          if (typeof instance.forceUpdate === 'function') {
            instance.forceUpdate();
          } else if (
            instance.updater != null &&
            typeof instance.updater.enqueueForceUpdate === 'function'
          ) {
            instance.updater.enqueueForceUpdate(
              this,
              function () {},
              'forceUpdate'
            );
          }
        }
        function legacy_renderer_ownKeys(object, enumerableOnly) {
          var keys = Object.keys(object);
          if (Object.getOwnPropertySymbols) {
            var symbols = Object.getOwnPropertySymbols(object);
            if (enumerableOnly)
              symbols = symbols.filter(function (sym) {
                return Object.getOwnPropertyDescriptor(object, sym).enumerable;
              });
            keys.push.apply(keys, symbols);
          }
          return keys;
        }
        function legacy_renderer_objectSpread(target) {
          for (var i = 1; i < arguments.length; i++) {
            var source = arguments[i] != null ? arguments[i] : {};
            if (i % 2) {
              legacy_renderer_ownKeys(Object(source), true).forEach(
                function (key) {
                  legacy_renderer_defineProperty(target, key, source[key]);
                }
              );
            } else if (Object.getOwnPropertyDescriptors) {
              Object.defineProperties(
                target,
                Object.getOwnPropertyDescriptors(source)
              );
            } else {
              legacy_renderer_ownKeys(Object(source)).forEach(function (key) {
                Object.defineProperty(
                  target,
                  key,
                  Object.getOwnPropertyDescriptor(source, key)
                );
              });
            }
          }
          return target;
        }
        function legacy_renderer_defineProperty(obj, key, value) {
          if (key in obj) {
            Object.defineProperty(obj, key, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          } else {
            obj[key] = value;
          }
          return obj;
        }
        function legacy_renderer_typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            legacy_renderer_typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            legacy_renderer_typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return legacy_renderer_typeof(obj);
        }
        function getData(internalInstance) {
          var displayName = null;
          var key = null;
          if (internalInstance._currentElement != null) {
            if (internalInstance._currentElement.key) {
              key = String(internalInstance._currentElement.key);
            }
            var elementType = internalInstance._currentElement.type;
            if (typeof elementType === 'string') {
              displayName = elementType;
            } else if (typeof elementType === 'function') {
              displayName = getDisplayName(elementType);
            }
          }
          return {
            displayName,
            key,
          };
        }
        function getElementType(internalInstance) {
          if (internalInstance._currentElement != null) {
            var elementType = internalInstance._currentElement.type;
            if (typeof elementType === 'function') {
              var publicInstance = internalInstance.getPublicInstance();
              if (publicInstance !== null) {
                return types_ElementTypeClass;
              } else {
                return types_ElementTypeFunction;
              }
            } else if (typeof elementType === 'string') {
              return ElementTypeHostComponent;
            }
          }
          return ElementTypeOtherOrUnknown;
        }
        function getChildren(internalInstance) {
          var children = [];
          if (legacy_renderer_typeof(internalInstance) !== 'object') {
          } else if (
            internalInstance._currentElement === null ||
            internalInstance._currentElement === false
          ) {
          } else if (internalInstance._renderedComponent) {
            var child = internalInstance._renderedComponent;
            if (getElementType(child) !== ElementTypeOtherOrUnknown) {
              children.push(child);
            }
          } else if (internalInstance._renderedChildren) {
            var renderedChildren = internalInstance._renderedChildren;
            for (var name in renderedChildren) {
              var _child = renderedChildren[name];
              if (getElementType(_child) !== ElementTypeOtherOrUnknown) {
                children.push(_child);
              }
            }
          }
          return children;
        }
        function legacy_renderer_attach(hook, rendererID, renderer, global2) {
          var idToInternalInstanceMap = new Map();
          var internalInstanceToIDMap = new WeakMap();
          var internalInstanceToRootIDMap = new WeakMap();
          var getElementIDForHostInstance = null;
          var findHostInstanceForInternalID;
          var getNearestMountedDOMNode = function getNearestMountedDOMNode(
            node
          ) {
            return null;
          };
          if (renderer.ComponentTree) {
            getElementIDForHostInstance = function getElementIDForHostInstance(
              node
            ) {
              var internalInstance =
                renderer.ComponentTree.getClosestInstanceFromNode(node);
              return internalInstanceToIDMap.get(internalInstance) || null;
            };
            findHostInstanceForInternalID =
              function findHostInstanceForInternalID(id) {
                var internalInstance = idToInternalInstanceMap.get(id);
                return renderer.ComponentTree.getNodeFromInstance(
                  internalInstance
                );
              };
            getNearestMountedDOMNode = function getNearestMountedDOMNode(node) {
              var internalInstance =
                renderer.ComponentTree.getClosestInstanceFromNode(node);
              if (internalInstance != null) {
                return renderer.ComponentTree.getNodeFromInstance(
                  internalInstance
                );
              }
              return null;
            };
          } else if (renderer.Mount.getID && renderer.Mount.getNode) {
            getElementIDForHostInstance = function getElementIDForHostInstance(
              node
            ) {
              return null;
            };
            findHostInstanceForInternalID =
              function findHostInstanceForInternalID(id) {
                return null;
              };
          }
          function getDisplayNameForElementID(id) {
            var internalInstance = idToInternalInstanceMap.get(id);
            return internalInstance
              ? getData(internalInstance).displayName
              : null;
          }
          function getID(internalInstance) {
            if (
              legacy_renderer_typeof(internalInstance) !== 'object' ||
              internalInstance === null
            ) {
              throw new Error('Invalid internal instance: ' + internalInstance);
            }
            if (!internalInstanceToIDMap.has(internalInstance)) {
              var _id = getUID();
              internalInstanceToIDMap.set(internalInstance, _id);
              idToInternalInstanceMap.set(_id, internalInstance);
            }
            return internalInstanceToIDMap.get(internalInstance);
          }
          function areEqualArrays(a, b) {
            if (a.length !== b.length) {
              return false;
            }
            for (var i = 0; i < a.length; i++) {
              if (a[i] !== b[i]) {
                return false;
              }
            }
            return true;
          }
          var parentIDStack = [];
          var oldReconcilerMethods = null;
          if (renderer.Reconciler) {
            oldReconcilerMethods = decorateMany(renderer.Reconciler, {
              mountComponent: function mountComponent(fn, args) {
                var internalInstance = args[0];
                var hostContainerInfo = args[3];
                if (
                  getElementType(internalInstance) === ElementTypeOtherOrUnknown
                ) {
                  return fn.apply(this, args);
                }
                if (hostContainerInfo._topLevelWrapper === undefined) {
                  return fn.apply(this, args);
                }
                var id = getID(internalInstance);
                var parentID =
                  parentIDStack.length > 0
                    ? parentIDStack[parentIDStack.length - 1]
                    : 0;
                recordMount(internalInstance, id, parentID);
                parentIDStack.push(id);
                internalInstanceToRootIDMap.set(
                  internalInstance,
                  getID(hostContainerInfo._topLevelWrapper)
                );
                try {
                  var result = fn.apply(this, args);
                  parentIDStack.pop();
                  return result;
                } catch (err) {
                  parentIDStack = [];
                  throw err;
                } finally {
                  if (parentIDStack.length === 0) {
                    var rootID =
                      internalInstanceToRootIDMap.get(internalInstance);
                    if (rootID === undefined) {
                      throw new Error('Expected to find root ID.');
                    }
                    flushPendingEvents(rootID);
                  }
                }
              },
              performUpdateIfNecessary: function performUpdateIfNecessary(
                fn,
                args
              ) {
                var internalInstance = args[0];
                if (
                  getElementType(internalInstance) === ElementTypeOtherOrUnknown
                ) {
                  return fn.apply(this, args);
                }
                var id = getID(internalInstance);
                parentIDStack.push(id);
                var prevChildren = getChildren(internalInstance);
                try {
                  var result = fn.apply(this, args);
                  var nextChildren = getChildren(internalInstance);
                  if (!areEqualArrays(prevChildren, nextChildren)) {
                    recordReorder(internalInstance, id, nextChildren);
                  }
                  parentIDStack.pop();
                  return result;
                } catch (err) {
                  parentIDStack = [];
                  throw err;
                } finally {
                  if (parentIDStack.length === 0) {
                    var rootID =
                      internalInstanceToRootIDMap.get(internalInstance);
                    if (rootID === undefined) {
                      throw new Error('Expected to find root ID.');
                    }
                    flushPendingEvents(rootID);
                  }
                }
              },
              receiveComponent: function receiveComponent(fn, args) {
                var internalInstance = args[0];
                if (
                  getElementType(internalInstance) === ElementTypeOtherOrUnknown
                ) {
                  return fn.apply(this, args);
                }
                var id = getID(internalInstance);
                parentIDStack.push(id);
                var prevChildren = getChildren(internalInstance);
                try {
                  var result = fn.apply(this, args);
                  var nextChildren = getChildren(internalInstance);
                  if (!areEqualArrays(prevChildren, nextChildren)) {
                    recordReorder(internalInstance, id, nextChildren);
                  }
                  parentIDStack.pop();
                  return result;
                } catch (err) {
                  parentIDStack = [];
                  throw err;
                } finally {
                  if (parentIDStack.length === 0) {
                    var rootID =
                      internalInstanceToRootIDMap.get(internalInstance);
                    if (rootID === undefined) {
                      throw new Error('Expected to find root ID.');
                    }
                    flushPendingEvents(rootID);
                  }
                }
              },
              unmountComponent: function unmountComponent(fn, args) {
                var internalInstance = args[0];
                if (
                  getElementType(internalInstance) === ElementTypeOtherOrUnknown
                ) {
                  return fn.apply(this, args);
                }
                var id = getID(internalInstance);
                parentIDStack.push(id);
                try {
                  var result = fn.apply(this, args);
                  parentIDStack.pop();
                  recordUnmount(internalInstance, id);
                  return result;
                } catch (err) {
                  parentIDStack = [];
                  throw err;
                } finally {
                  if (parentIDStack.length === 0) {
                    var rootID =
                      internalInstanceToRootIDMap.get(internalInstance);
                    if (rootID === undefined) {
                      throw new Error('Expected to find root ID.');
                    }
                    flushPendingEvents(rootID);
                  }
                }
              },
            });
          }
          function cleanup() {
            if (oldReconcilerMethods !== null) {
              if (renderer.Component) {
                restoreMany(renderer.Component.Mixin, oldReconcilerMethods);
              } else {
                restoreMany(renderer.Reconciler, oldReconcilerMethods);
              }
            }
            oldReconcilerMethods = null;
          }
          function recordMount(internalInstance, id, parentID) {
            var isRoot = parentID === 0;
            if (__DEBUG__) {
              console.log(
                '%crecordMount()',
                'color: green; font-weight: bold;',
                id,
                getData(internalInstance).displayName
              );
            }
            if (isRoot) {
              var hasOwnerMetadata =
                internalInstance._currentElement != null &&
                internalInstance._currentElement._owner != null;
              pushOperation(TREE_OPERATION_ADD);
              pushOperation(id);
              pushOperation(ElementTypeRoot);
              pushOperation(0);
              pushOperation(0);
              pushOperation(0);
              pushOperation(hasOwnerMetadata ? 1 : 0);
            } else {
              var type = getElementType(internalInstance);
              var _getData = getData(internalInstance),
                displayName = _getData.displayName,
                key = _getData.key;
              var ownerID =
                internalInstance._currentElement != null &&
                internalInstance._currentElement._owner != null
                  ? getID(internalInstance._currentElement._owner)
                  : 0;
              var displayNameStringID = getStringID(displayName);
              var keyStringID = getStringID(key);
              pushOperation(TREE_OPERATION_ADD);
              pushOperation(id);
              pushOperation(type);
              pushOperation(parentID);
              pushOperation(ownerID);
              pushOperation(displayNameStringID);
              pushOperation(keyStringID);
            }
          }
          function recordReorder(internalInstance, id, nextChildren) {
            pushOperation(TREE_OPERATION_REORDER_CHILDREN);
            pushOperation(id);
            var nextChildIDs = nextChildren.map(getID);
            pushOperation(nextChildIDs.length);
            for (var i = 0; i < nextChildIDs.length; i++) {
              pushOperation(nextChildIDs[i]);
            }
          }
          function recordUnmount(internalInstance, id) {
            pendingUnmountedIDs.push(id);
            idToInternalInstanceMap.delete(id);
          }
          function crawlAndRecordInitialMounts(id, parentID, rootID) {
            if (__DEBUG__) {
              console.group('crawlAndRecordInitialMounts() id:', id);
            }
            var internalInstance = idToInternalInstanceMap.get(id);
            if (internalInstance != null) {
              internalInstanceToRootIDMap.set(internalInstance, rootID);
              recordMount(internalInstance, id, parentID);
              getChildren(internalInstance).forEach(function (child) {
                return crawlAndRecordInitialMounts(getID(child), id, rootID);
              });
            }
            if (__DEBUG__) {
              console.groupEnd();
            }
          }
          function flushInitialOperations() {
            var roots =
              renderer.Mount._instancesByReactRootID ||
              renderer.Mount._instancesByContainerID;
            for (var key in roots) {
              var internalInstance = roots[key];
              var _id2 = getID(internalInstance);
              crawlAndRecordInitialMounts(_id2, 0, _id2);
              flushPendingEvents(_id2);
            }
          }
          var pendingOperations = [];
          var pendingStringTable = new Map();
          var pendingUnmountedIDs = [];
          var pendingStringTableLength = 0;
          var pendingUnmountedRootID = null;
          function flushPendingEvents(rootID) {
            if (
              pendingOperations.length === 0 &&
              pendingUnmountedIDs.length === 0 &&
              pendingUnmountedRootID === null
            ) {
              return;
            }
            var numUnmountIDs =
              pendingUnmountedIDs.length +
              (pendingUnmountedRootID === null ? 0 : 1);
            var operations = new Array(
              2 +
                1 +
                pendingStringTableLength +
                (numUnmountIDs > 0 ? 2 + numUnmountIDs : 0) +
                pendingOperations.length
            );
            var i = 0;
            operations[i++] = rendererID;
            operations[i++] = rootID;
            operations[i++] = pendingStringTableLength;
            pendingStringTable.forEach(function (value, key) {
              operations[i++] = key.length;
              var encodedKey = utfEncodeString(key);
              for (var j2 = 0; j2 < encodedKey.length; j2++) {
                operations[i + j2] = encodedKey[j2];
              }
              i += key.length;
            });
            if (numUnmountIDs > 0) {
              operations[i++] = TREE_OPERATION_REMOVE;
              operations[i++] = numUnmountIDs;
              for (var j = 0; j < pendingUnmountedIDs.length; j++) {
                operations[i++] = pendingUnmountedIDs[j];
              }
              if (pendingUnmountedRootID !== null) {
                operations[i] = pendingUnmountedRootID;
                i++;
              }
            }
            for (var _j = 0; _j < pendingOperations.length; _j++) {
              operations[i + _j] = pendingOperations[_j];
            }
            i += pendingOperations.length;
            if (__DEBUG__) {
              printOperationsArray(operations);
            }
            hook.emit('operations', operations);
            pendingOperations.length = 0;
            pendingUnmountedIDs = [];
            pendingUnmountedRootID = null;
            pendingStringTable.clear();
            pendingStringTableLength = 0;
          }
          function pushOperation(op) {
            if (false) {
            }
            pendingOperations.push(op);
          }
          function getStringID(str) {
            if (str === null) {
              return 0;
            }
            var existingID = pendingStringTable.get(str);
            if (existingID !== undefined) {
              return existingID;
            }
            var stringID = pendingStringTable.size + 1;
            pendingStringTable.set(str, stringID);
            pendingStringTableLength += str.length + 1;
            return stringID;
          }
          var currentlyInspectedElementID = null;
          var currentlyInspectedPaths = {};
          function mergeInspectedPaths(path) {
            var current = currentlyInspectedPaths;
            path.forEach(function (key) {
              if (!current[key]) {
                current[key] = {};
              }
              current = current[key];
            });
          }
          function createIsPathAllowed(key) {
            return function isPathAllowed(path) {
              var current = currentlyInspectedPaths[key];
              if (!current) {
                return false;
              }
              for (var i = 0; i < path.length; i++) {
                current = current[path[i]];
                if (!current) {
                  return false;
                }
              }
              return true;
            };
          }
          function getInstanceAndStyle(id) {
            var instance = null;
            var style = null;
            var internalInstance = idToInternalInstanceMap.get(id);
            if (internalInstance != null) {
              instance = internalInstance._instance || null;
              var element = internalInstance._currentElement;
              if (element != null && element.props != null) {
                style = element.props.style || null;
              }
            }
            return {
              instance,
              style,
            };
          }
          function updateSelectedElement(id) {
            var internalInstance = idToInternalInstanceMap.get(id);
            if (internalInstance == null) {
              console.warn('Could not find instance with id "'.concat(id, '"'));
              return;
            }
            switch (getElementType(internalInstance)) {
              case types_ElementTypeClass:
                global2.$r = internalInstance._instance;
                break;
              case types_ElementTypeFunction:
                var element = internalInstance._currentElement;
                if (element == null) {
                  console.warn(
                    'Could not find element with id "'.concat(id, '"')
                  );
                  return;
                }
                global2.$r = {
                  props: element.props,
                  type: element.type,
                };
                break;
              default:
                global2.$r = null;
                break;
            }
          }
          function storeAsGlobal(id, path, count) {
            var inspectedElement = inspectElementRaw(id);
            if (inspectedElement !== null) {
              var value = utils_getInObject(inspectedElement, path);
              var key = '$reactTemp'.concat(count);
              window[key] = value;
              console.log(key);
              console.log(value);
            }
          }
          function getSerializedElementValueByPath(id, path) {
            var inspectedElement = inspectElementRaw(id);
            if (inspectedElement !== null) {
              var valueToCopy = utils_getInObject(inspectedElement, path);
              return serializeToString(valueToCopy);
            }
          }
          function inspectElement(requestID, id, path, forceFullData) {
            if (forceFullData || currentlyInspectedElementID !== id) {
              currentlyInspectedElementID = id;
              currentlyInspectedPaths = {};
            }
            var inspectedElement = inspectElementRaw(id);
            if (inspectedElement === null) {
              return {
                id,
                responseID: requestID,
                type: 'not-found',
              };
            }
            if (path !== null) {
              mergeInspectedPaths(path);
            }
            updateSelectedElement(id);
            inspectedElement.context = cleanForBridge(
              inspectedElement.context,
              createIsPathAllowed('context')
            );
            inspectedElement.props = cleanForBridge(
              inspectedElement.props,
              createIsPathAllowed('props')
            );
            inspectedElement.state = cleanForBridge(
              inspectedElement.state,
              createIsPathAllowed('state')
            );
            return {
              id,
              responseID: requestID,
              type: 'full-data',
              value: inspectedElement,
            };
          }
          function inspectElementRaw(id) {
            var internalInstance = idToInternalInstanceMap.get(id);
            if (internalInstance == null) {
              return null;
            }
            var _getData2 = getData(internalInstance),
              key = _getData2.key;
            var type = getElementType(internalInstance);
            var context = null;
            var owners = null;
            var props = null;
            var state = null;
            var element = internalInstance._currentElement;
            if (element !== null) {
              props = element.props;
              var owner = element._owner;
              if (owner) {
                owners = [];
                while (owner != null) {
                  owners.push({
                    displayName: getData(owner).displayName || 'Unknown',
                    id: getID(owner),
                    key: element.key,
                    type: getElementType(owner),
                  });
                  if (owner._currentElement) {
                    owner = owner._currentElement._owner;
                  }
                }
              }
            }
            var publicInstance = internalInstance._instance;
            if (publicInstance != null) {
              context = publicInstance.context || null;
              state = publicInstance.state || null;
            }
            var errors = [];
            var warnings = [];
            return {
              id,
              canEditHooks: false,
              canEditFunctionProps: false,
              canEditHooksAndDeletePaths: false,
              canEditHooksAndRenamePaths: false,
              canEditFunctionPropsDeletePaths: false,
              canEditFunctionPropsRenamePaths: false,
              canToggleError: false,
              isErrored: false,
              canToggleSuspense: false,
              canViewSource:
                type === types_ElementTypeClass ||
                type === types_ElementTypeFunction,
              source: null,
              hasLegacyContext: true,
              type,
              key: key != null ? key : null,
              context,
              hooks: null,
              props,
              state,
              errors,
              warnings,
              owners,
              rootType: null,
              rendererPackageName: null,
              rendererVersion: null,
              plugins: {
                stylex: null,
              },
              nativeTag: null,
            };
          }
          function logElementToConsole(id) {
            var result = inspectElementRaw(id);
            if (result === null) {
              console.warn('Could not find element with id "'.concat(id, '"'));
              return;
            }
            var displayName = getDisplayNameForElementID(id);
            var supportsGroup = typeof console.groupCollapsed === 'function';
            if (supportsGroup) {
              console.groupCollapsed(
                '[Click to expand] %c<'.concat(
                  displayName || 'Component',
                  ' />'
                ),
                'color: var(--dom-tag-name-color); font-weight: normal;'
              );
            }
            if (result.props !== null) {
              console.log('Props:', result.props);
            }
            if (result.state !== null) {
              console.log('State:', result.state);
            }
            if (result.context !== null) {
              console.log('Context:', result.context);
            }
            var hostInstance = findHostInstanceForInternalID(id);
            if (hostInstance !== null) {
              console.log('Node:', hostInstance);
            }
            if (window.chrome || /firefox/i.test(navigator.userAgent)) {
              console.log(
                'Right-click any value to save it as a global variable for further inspection.'
              );
            }
            if (supportsGroup) {
              console.groupEnd();
            }
          }
          function getElementAttributeByPath(id, path) {
            var inspectedElement = inspectElementRaw(id);
            if (inspectedElement !== null) {
              return utils_getInObject(inspectedElement, path);
            }
            return;
          }
          function getElementSourceFunctionById(id) {
            var internalInstance = idToInternalInstanceMap.get(id);
            if (internalInstance == null) {
              console.warn('Could not find instance with id "'.concat(id, '"'));
              return null;
            }
            var element = internalInstance._currentElement;
            if (element == null) {
              console.warn('Could not find element with id "'.concat(id, '"'));
              return null;
            }
            return element.type;
          }
          function deletePath(type, id, hookID, path) {
            var internalInstance = idToInternalInstanceMap.get(id);
            if (internalInstance != null) {
              var publicInstance = internalInstance._instance;
              if (publicInstance != null) {
                switch (type) {
                  case 'context':
                    deletePathInObject(publicInstance.context, path);
                    forceUpdate(publicInstance);
                    break;
                  case 'hooks':
                    throw new Error('Hooks not supported by this renderer');
                  case 'props':
                    var element = internalInstance._currentElement;
                    internalInstance._currentElement =
                      legacy_renderer_objectSpread(
                        legacy_renderer_objectSpread({}, element),
                        {},
                        {
                          props: copyWithDelete(element.props, path),
                        }
                      );
                    forceUpdate(publicInstance);
                    break;
                  case 'state':
                    deletePathInObject(publicInstance.state, path);
                    forceUpdate(publicInstance);
                    break;
                }
              }
            }
          }
          function renamePath(type, id, hookID, oldPath, newPath) {
            var internalInstance = idToInternalInstanceMap.get(id);
            if (internalInstance != null) {
              var publicInstance = internalInstance._instance;
              if (publicInstance != null) {
                switch (type) {
                  case 'context':
                    renamePathInObject(
                      publicInstance.context,
                      oldPath,
                      newPath
                    );
                    forceUpdate(publicInstance);
                    break;
                  case 'hooks':
                    throw new Error('Hooks not supported by this renderer');
                  case 'props':
                    var element = internalInstance._currentElement;
                    internalInstance._currentElement =
                      legacy_renderer_objectSpread(
                        legacy_renderer_objectSpread({}, element),
                        {},
                        {
                          props: copyWithRename(
                            element.props,
                            oldPath,
                            newPath
                          ),
                        }
                      );
                    forceUpdate(publicInstance);
                    break;
                  case 'state':
                    renamePathInObject(publicInstance.state, oldPath, newPath);
                    forceUpdate(publicInstance);
                    break;
                }
              }
            }
          }
          function overrideValueAtPath(type, id, hookID, path, value) {
            var internalInstance = idToInternalInstanceMap.get(id);
            if (internalInstance != null) {
              var publicInstance = internalInstance._instance;
              if (publicInstance != null) {
                switch (type) {
                  case 'context':
                    utils_setInObject(publicInstance.context, path, value);
                    forceUpdate(publicInstance);
                    break;
                  case 'hooks':
                    throw new Error('Hooks not supported by this renderer');
                  case 'props':
                    var element = internalInstance._currentElement;
                    internalInstance._currentElement =
                      legacy_renderer_objectSpread(
                        legacy_renderer_objectSpread({}, element),
                        {},
                        {
                          props: copyWithSet(element.props, path, value),
                        }
                      );
                    forceUpdate(publicInstance);
                    break;
                  case 'state':
                    utils_setInObject(publicInstance.state, path, value);
                    forceUpdate(publicInstance);
                    break;
                }
              }
            }
          }
          var getProfilingData = function getProfilingData() {
            throw new Error('getProfilingData not supported by this renderer');
          };
          var handleCommitFiberRoot = function handleCommitFiberRoot() {
            throw new Error(
              'handleCommitFiberRoot not supported by this renderer'
            );
          };
          var handleCommitFiberUnmount = function handleCommitFiberUnmount() {
            throw new Error(
              'handleCommitFiberUnmount not supported by this renderer'
            );
          };
          var handlePostCommitFiberRoot = function handlePostCommitFiberRoot() {
            throw new Error(
              'handlePostCommitFiberRoot not supported by this renderer'
            );
          };
          var overrideError = function overrideError() {
            throw new Error('overrideError not supported by this renderer');
          };
          var overrideSuspense = function overrideSuspense() {
            throw new Error('overrideSuspense not supported by this renderer');
          };
          var startProfiling = function startProfiling() {};
          var stopProfiling = function stopProfiling() {};
          function getBestMatchForTrackedPath() {
            return null;
          }
          function getPathForElement(id) {
            return null;
          }
          function updateComponentFilters(componentFilters) {}
          function getEnvironmentNames() {
            return [];
          }
          function setTraceUpdatesEnabled(enabled) {}
          function setTrackedPath(path) {}
          function getOwnersList(id) {
            return null;
          }
          function clearErrorsAndWarnings() {}
          function clearErrorsForElementID(id) {}
          function clearWarningsForElementID(id) {}
          function hasElementWithId(id) {
            return idToInternalInstanceMap.has(id);
          }
          return {
            clearErrorsAndWarnings,
            clearErrorsForElementID,
            clearWarningsForElementID,
            cleanup,
            getSerializedElementValueByPath,
            deletePath,
            flushInitialOperations,
            getBestMatchForTrackedPath,
            getDisplayNameForElementID,
            getNearestMountedDOMNode,
            getElementIDForHostInstance,
            getInstanceAndStyle,
            findHostInstancesForElementID:
              function findHostInstancesForElementID(id) {
                var hostInstance = findHostInstanceForInternalID(id);
                return hostInstance == null ? null : [hostInstance];
              },
            getOwnersList,
            getPathForElement,
            getProfilingData,
            handleCommitFiberRoot,
            handleCommitFiberUnmount,
            handlePostCommitFiberRoot,
            hasElementWithId,
            inspectElement,
            logElementToConsole,
            overrideError,
            overrideSuspense,
            overrideValueAtPath,
            renamePath,
            getElementAttributeByPath,
            getElementSourceFunctionById,
            renderer,
            setTraceUpdatesEnabled,
            setTrackedPath,
            startProfiling,
            stopProfiling,
            storeAsGlobal,
            updateComponentFilters,
            getEnvironmentNames,
          };
        }
        function isMatchingRender(version) {
          return !hasAssignedBackend(version);
        }
        function attachRenderer(
          hook,
          id,
          renderer,
          global2,
          shouldStartProfilingNow,
          profilingSettings
        ) {
          if (
            !isMatchingRender(renderer.reconcilerVersion || renderer.version)
          ) {
            return;
          }
          var rendererInterface = hook.rendererInterfaces.get(id);
          if (rendererInterface == null) {
            if (typeof renderer.getCurrentComponentInfo === 'function') {
              rendererInterface = attach(hook, id, renderer, global2);
            } else if (
              typeof renderer.findFiberByHostInstance === 'function' ||
              renderer.currentDispatcherRef != null
            ) {
              rendererInterface = renderer_attach(
                hook,
                id,
                renderer,
                global2,
                shouldStartProfilingNow,
                profilingSettings
              );
            } else if (renderer.ComponentTree) {
              rendererInterface = legacy_renderer_attach(
                hook,
                id,
                renderer,
                global2
              );
            } else {
            }
          }
          return rendererInterface;
        }
        function formatConsoleArguments_toConsumableArray(arr) {
          return (
            formatConsoleArguments_arrayWithoutHoles(arr) ||
            formatConsoleArguments_iterableToArray(arr) ||
            formatConsoleArguments_unsupportedIterableToArray(arr) ||
            formatConsoleArguments_nonIterableSpread()
          );
        }
        function formatConsoleArguments_nonIterableSpread() {
          throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function formatConsoleArguments_iterableToArray(iter) {
          if (typeof Symbol !== 'undefined' && Symbol.iterator in Object(iter))
            return Array.from(iter);
        }
        function formatConsoleArguments_arrayWithoutHoles(arr) {
          if (Array.isArray(arr))
            return formatConsoleArguments_arrayLikeToArray(arr);
        }
        function formatConsoleArguments_slicedToArray(arr, i) {
          return (
            formatConsoleArguments_arrayWithHoles(arr) ||
            formatConsoleArguments_iterableToArrayLimit(arr, i) ||
            formatConsoleArguments_unsupportedIterableToArray(arr, i) ||
            formatConsoleArguments_nonIterableRest()
          );
        }
        function formatConsoleArguments_nonIterableRest() {
          throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function formatConsoleArguments_unsupportedIterableToArray(o, minLen) {
          if (!o) return;
          if (typeof o === 'string')
            return formatConsoleArguments_arrayLikeToArray(o, minLen);
          var n = Object.prototype.toString.call(o).slice(8, -1);
          if (n === 'Object' && o.constructor) n = o.constructor.name;
          if (n === 'Map' || n === 'Set') return Array.from(o);
          if (
            n === 'Arguments' ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return formatConsoleArguments_arrayLikeToArray(o, minLen);
        }
        function formatConsoleArguments_arrayLikeToArray(arr, len) {
          if (len == null || len > arr.length) len = arr.length;
          for (var i = 0, arr2 = new Array(len); i < len; i++) {
            arr2[i] = arr[i];
          }
          return arr2;
        }
        function formatConsoleArguments_iterableToArrayLimit(arr, i) {
          if (
            typeof Symbol === 'undefined' ||
            !(Symbol.iterator in Object(arr))
          )
            return;
          var _arr = [];
          var _n = true;
          var _d = false;
          var _e = undefined;
          try {
            for (
              var _i = arr[Symbol.iterator](), _s;
              !(_n = (_s = _i.next()).done);
              _n = true
            ) {
              _arr.push(_s.value);
              if (i && _arr.length === i) break;
            }
          } catch (err) {
            _d = true;
            _e = err;
          } finally {
            try {
              if (!_n && _i['return'] != null) _i['return']();
            } finally {
              if (_d) throw _e;
            }
          }
          return _arr;
        }
        function formatConsoleArguments_arrayWithHoles(arr) {
          if (Array.isArray(arr)) return arr;
        }
        function formatConsoleArguments(maybeMessage) {
          for (
            var _len = arguments.length,
              inputArgs = new Array(_len > 1 ? _len - 1 : 0),
              _key = 1;
            _key < _len;
            _key++
          ) {
            inputArgs[_key - 1] = arguments[_key];
          }
          if (inputArgs.length === 0 || typeof maybeMessage !== 'string') {
            return [maybeMessage].concat(inputArgs);
          }
          var args = inputArgs.slice();
          var template = '';
          var argumentsPointer = 0;
          for (var i = 0; i < maybeMessage.length; ++i) {
            var currentChar = maybeMessage[i];
            if (currentChar !== '%') {
              template += currentChar;
              continue;
            }
            var nextChar = maybeMessage[i + 1];
            ++i;
            switch (nextChar) {
              case 'c':
              case 'O':
              case 'o': {
                ++argumentsPointer;
                template += '%'.concat(nextChar);
                break;
              }
              case 'd':
              case 'i': {
                var _args$splice = args.splice(argumentsPointer, 1),
                  _args$splice2 = formatConsoleArguments_slicedToArray(
                    _args$splice,
                    1
                  ),
                  arg = _args$splice2[0];
                template += parseInt(arg, 10).toString();
                break;
              }
              case 'f': {
                var _args$splice3 = args.splice(argumentsPointer, 1),
                  _args$splice4 = formatConsoleArguments_slicedToArray(
                    _args$splice3,
                    1
                  ),
                  _arg = _args$splice4[0];
                template += parseFloat(_arg).toString();
                break;
              }
              case 's': {
                var _args$splice5 = args.splice(argumentsPointer, 1),
                  _args$splice6 = formatConsoleArguments_slicedToArray(
                    _args$splice5,
                    1
                  ),
                  _arg2 = _args$splice6[0];
                template += String(_arg2);
                break;
              }
              default:
                template += '%'.concat(nextChar);
            }
          }
          return [template].concat(
            formatConsoleArguments_toConsumableArray(args)
          );
        }
        function hook_createForOfIteratorHelper(o, allowArrayLike) {
          var it;
          if (typeof Symbol === 'undefined' || o[Symbol.iterator] == null) {
            if (
              Array.isArray(o) ||
              (it = hook_unsupportedIterableToArray(o)) ||
              (allowArrayLike && o && typeof o.length === 'number')
            ) {
              if (it) o = it;
              var i = 0;
              var F = function F() {};
              return {
                s: F,
                n: function n() {
                  if (i >= o.length) return { done: true };
                  return { done: false, value: o[i++] };
                },
                e: function e(_e) {
                  throw _e;
                },
                f: F,
              };
            }
            throw new TypeError(`Invalid attempt to iterate non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
          }
          var normalCompletion = true,
            didErr = false,
            err;
          return {
            s: function s() {
              it = o[Symbol.iterator]();
            },
            n: function n() {
              var step = it.next();
              normalCompletion = step.done;
              return step;
            },
            e: function e(_e2) {
              didErr = true;
              err = _e2;
            },
            f: function f() {
              try {
                if (!normalCompletion && it.return != null) it.return();
              } finally {
                if (didErr) throw err;
              }
            },
          };
        }
        function hook_toConsumableArray(arr) {
          return (
            hook_arrayWithoutHoles(arr) ||
            hook_iterableToArray(arr) ||
            hook_unsupportedIterableToArray(arr) ||
            hook_nonIterableSpread()
          );
        }
        function hook_nonIterableSpread() {
          throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
        }
        function hook_unsupportedIterableToArray(o, minLen) {
          if (!o) return;
          if (typeof o === 'string') return hook_arrayLikeToArray(o, minLen);
          var n = Object.prototype.toString.call(o).slice(8, -1);
          if (n === 'Object' && o.constructor) n = o.constructor.name;
          if (n === 'Map' || n === 'Set') return Array.from(o);
          if (
            n === 'Arguments' ||
            /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)
          )
            return hook_arrayLikeToArray(o, minLen);
        }
        function hook_iterableToArray(iter) {
          if (typeof Symbol !== 'undefined' && Symbol.iterator in Object(iter))
            return Array.from(iter);
        }
        function hook_arrayWithoutHoles(arr) {
          if (Array.isArray(arr)) return hook_arrayLikeToArray(arr);
        }
        function hook_arrayLikeToArray(arr, len) {
          if (len == null || len > arr.length) len = arr.length;
          for (var i = 0, arr2 = new Array(len); i < len; i++) {
            arr2[i] = arr[i];
          }
          return arr2;
        }
        var PREFIX_REGEX = /\s{4}(in|at)\s{1}/;
        var ROW_COLUMN_NUMBER_REGEX = /:\d+:\d+(\n|$)/;
        function isStringComponentStack(text) {
          return PREFIX_REGEX.test(text) || ROW_COLUMN_NUMBER_REGEX.test(text);
        }
        var frameDiffs = / \(\<anonymous\>\)$|\@unknown\:0\:0$|\(|\)|\[|\]/gm;
        function areStackTracesEqual(a, b) {
          return a.replace(frameDiffs, '') === b.replace(frameDiffs, '');
        }
        var targetConsole = console;
        var defaultProfilingSettings = {
          recordChangeDescriptions: false,
          recordTimeline: false,
        };
        function installHook(target, maybeSettingsOrSettingsPromise) {
          var shouldStartProfilingNow =
            arguments.length > 2 && arguments[2] !== undefined
              ? arguments[2]
              : false;
          var profilingSettings =
            arguments.length > 3 && arguments[3] !== undefined
              ? arguments[3]
              : defaultProfilingSettings;
          if (target.hasOwnProperty('__REACT_DEVTOOLS_GLOBAL_HOOK__')) {
            return null;
          }
          function detectReactBuildType(renderer) {
            try {
              if (typeof renderer.version === 'string') {
                if (renderer.bundleType > 0) {
                  return 'development';
                }
                return 'production';
              }
              var _toString = Function.prototype.toString;
              if (renderer.Mount && renderer.Mount._renderNewRootComponent) {
                var renderRootCode = _toString.call(
                  renderer.Mount._renderNewRootComponent
                );
                if (renderRootCode.indexOf('function') !== 0) {
                  return 'production';
                }
                if (renderRootCode.indexOf('storedMeasure') !== -1) {
                  return 'development';
                }
                if (
                  renderRootCode.indexOf('should be a pure function') !== -1
                ) {
                  if (renderRootCode.indexOf('NODE_ENV') !== -1) {
                    return 'development';
                  }
                  if (renderRootCode.indexOf('development') !== -1) {
                    return 'development';
                  }
                  if (renderRootCode.indexOf('true') !== -1) {
                    return 'development';
                  }
                  if (
                    renderRootCode.indexOf('nextElement') !== -1 ||
                    renderRootCode.indexOf('nextComponent') !== -1
                  ) {
                    return 'unminified';
                  } else {
                    return 'development';
                  }
                }
                if (
                  renderRootCode.indexOf('nextElement') !== -1 ||
                  renderRootCode.indexOf('nextComponent') !== -1
                ) {
                  return 'unminified';
                }
                return 'outdated';
              }
            } catch (err) {}
            return 'production';
          }
          function checkDCE(fn) {
            try {
              var _toString2 = Function.prototype.toString;
              var code = _toString2.call(fn);
              if (code.indexOf('^_^') > -1) {
                hasDetectedBadDCE = true;
                setTimeout(function () {
                  throw new Error(
                    'React is running in production mode, but dead code ' +
                      'elimination has not been applied. Read how to correctly ' +
                      'configure React for production: ' +
                      'https://react.dev/link/perf-use-production-build'
                  );
                });
              }
            } catch (err) {}
          }
          var isProfiling = shouldStartProfilingNow;
          var uidCounter2 = 0;
          function inject(renderer) {
            var id = ++uidCounter2;
            renderers.set(id, renderer);
            var reactBuildType = hasDetectedBadDCE
              ? 'deadcode'
              : detectReactBuildType(renderer);
            hook.emit('renderer', {
              id,
              renderer,
              reactBuildType,
            });
            var rendererInterface = attachRenderer(
              hook,
              id,
              renderer,
              target,
              isProfiling,
              profilingSettings
            );
            if (rendererInterface != null) {
              hook.rendererInterfaces.set(id, rendererInterface);
              hook.emit('renderer-attached', {
                id,
                rendererInterface,
              });
            } else {
              hook.hasUnsupportedRendererAttached = true;
              hook.emit('unsupported-renderer-version');
            }
            return id;
          }
          var hasDetectedBadDCE = false;
          function sub(event, fn) {
            hook.on(event, fn);
            return function () {
              return hook.off(event, fn);
            };
          }
          function on(event, fn) {
            if (!listeners[event]) {
              listeners[event] = [];
            }
            listeners[event].push(fn);
          }
          function off(event, fn) {
            if (!listeners[event]) {
              return;
            }
            var index = listeners[event].indexOf(fn);
            if (index !== -1) {
              listeners[event].splice(index, 1);
            }
            if (!listeners[event].length) {
              delete listeners[event];
            }
          }
          function emit(event, data) {
            if (listeners[event]) {
              listeners[event].map(function (fn) {
                return fn(data);
              });
            }
          }
          function getFiberRoots(rendererID) {
            var roots = fiberRoots;
            if (!roots[rendererID]) {
              roots[rendererID] = new Set();
            }
            return roots[rendererID];
          }
          function onCommitFiberUnmount(rendererID, fiber) {
            var rendererInterface = rendererInterfaces.get(rendererID);
            if (rendererInterface != null) {
              rendererInterface.handleCommitFiberUnmount(fiber);
            }
          }
          function onCommitFiberRoot(rendererID, root, priorityLevel) {
            var mountedRoots = hook.getFiberRoots(rendererID);
            var current = root.current;
            var isKnownRoot = mountedRoots.has(root);
            var isUnmounting =
              current.memoizedState == null ||
              current.memoizedState.element == null;
            if (!isKnownRoot && !isUnmounting) {
              mountedRoots.add(root);
            } else if (isKnownRoot && isUnmounting) {
              mountedRoots.delete(root);
            }
            var rendererInterface = rendererInterfaces.get(rendererID);
            if (rendererInterface != null) {
              rendererInterface.handleCommitFiberRoot(root, priorityLevel);
            }
          }
          function onPostCommitFiberRoot(rendererID, root) {
            var rendererInterface = rendererInterfaces.get(rendererID);
            if (rendererInterface != null) {
              rendererInterface.handlePostCommitFiberRoot(root);
            }
          }
          var isRunningDuringStrictModeInvocation = false;
          function setStrictMode(rendererID, isStrictMode) {
            isRunningDuringStrictModeInvocation = isStrictMode;
            if (isStrictMode) {
              patchConsoleForStrictMode();
            } else {
              unpatchConsoleForStrictMode();
            }
          }
          var unpatchConsoleCallbacks = [];
          function patchConsoleForStrictMode() {
            if (!hook.settings) {
              return;
            }
            if (unpatchConsoleCallbacks.length > 0) {
              return;
            }
            var consoleMethodsToOverrideForStrictMode = [
              'group',
              'groupCollapsed',
              'info',
              'log',
            ];
            var _loop = function _loop() {
              var method = _consoleMethodsToOver[_i];
              var originalMethod = targetConsole[method];
              var overrideMethod = function overrideMethod() {
                var settings = hook.settings;
                for (
                  var _len = arguments.length, args = new Array(_len), _key = 0;
                  _key < _len;
                  _key++
                ) {
                  args[_key] = arguments[_key];
                }
                if (settings == null) {
                  originalMethod.apply(undefined, args);
                  return;
                }
                if (settings.hideConsoleLogsInStrictMode) {
                  return;
                }
                if (false) {
                } else {
                  originalMethod.apply(
                    undefined,
                    [ANSI_STYLE_DIMMING_TEMPLATE].concat(
                      hook_toConsumableArray(
                        formatConsoleArguments.apply(undefined, args)
                      )
                    )
                  );
                }
              };
              targetConsole[method] = overrideMethod;
              unpatchConsoleCallbacks.push(function () {
                targetConsole[method] = originalMethod;
              });
            };
            for (
              var _i = 0,
                _consoleMethodsToOver = consoleMethodsToOverrideForStrictMode;
              _i < _consoleMethodsToOver.length;
              _i++
            ) {
              _loop();
            }
          }
          function unpatchConsoleForStrictMode() {
            unpatchConsoleCallbacks.forEach(function (callback) {
              return callback();
            });
            unpatchConsoleCallbacks.length = 0;
          }
          var openModuleRangesStack = [];
          var moduleRanges = [];
          function getTopStackFrameString(error) {
            var frames = error.stack.split(`
`);
            var frame = frames.length > 1 ? frames[1] : null;
            return frame;
          }
          function getInternalModuleRanges() {
            return moduleRanges;
          }
          function registerInternalModuleStart(error) {
            var startStackFrame = getTopStackFrameString(error);
            if (startStackFrame !== null) {
              openModuleRangesStack.push(startStackFrame);
            }
          }
          function registerInternalModuleStop(error) {
            if (openModuleRangesStack.length > 0) {
              var startStackFrame = openModuleRangesStack.pop();
              var stopStackFrame = getTopStackFrameString(error);
              if (stopStackFrame !== null) {
                moduleRanges.push([startStackFrame, stopStackFrame]);
              }
            }
          }
          function patchConsoleForErrorsAndWarnings() {
            if (!hook.settings) {
              return;
            }
            var consoleMethodsToOverrideForErrorsAndWarnings = [
              'error',
              'trace',
              'warn',
            ];
            var _loop2 = function _loop2() {
              var method = _consoleMethodsToOver2[_i2];
              var originalMethod = targetConsole[method];
              var overrideMethod = function overrideMethod() {
                var settings = hook.settings;
                for (
                  var _len2 = arguments.length,
                    args = new Array(_len2),
                    _key2 = 0;
                  _key2 < _len2;
                  _key2++
                ) {
                  args[_key2] = arguments[_key2];
                }
                if (settings == null) {
                  originalMethod.apply(undefined, args);
                  return;
                }
                if (
                  isRunningDuringStrictModeInvocation &&
                  settings.hideConsoleLogsInStrictMode
                ) {
                  return;
                }
                var injectedComponentStackAsFakeError = false;
                var alreadyHasComponentStack = false;
                if (settings.appendComponentStack) {
                  var lastArg = args.length > 0 ? args[args.length - 1] : null;
                  alreadyHasComponentStack =
                    typeof lastArg === 'string' &&
                    isStringComponentStack(lastArg);
                }
                var shouldShowInlineWarningsAndErrors =
                  settings.showInlineWarningsAndErrors &&
                  (method === 'error' || method === 'warn');
                var _iterator = hook_createForOfIteratorHelper(
                    hook.rendererInterfaces.values()
                  ),
                  _step;
                try {
                  for (_iterator.s(); !(_step = _iterator.n()).done; ) {
                    var rendererInterface = _step.value;
                    var { onErrorOrWarning, getComponentStack } =
                      rendererInterface;
                    try {
                      if (shouldShowInlineWarningsAndErrors) {
                        if (onErrorOrWarning != null) {
                          onErrorOrWarning(method, args.slice());
                        }
                      }
                    } catch (error) {
                      setTimeout(function () {
                        throw error;
                      }, 0);
                    }
                    try {
                      if (
                        settings.appendComponentStack &&
                        getComponentStack != null
                      ) {
                        var topFrame = Error('react-stack-top-frame');
                        var match = getComponentStack(topFrame);
                        if (match !== null) {
                          var { enableOwnerStacks, componentStack } = match;
                          if (componentStack !== '') {
                            var fakeError = new Error('');
                            if (false) {
                            } else {
                              fakeError.name = enableOwnerStacks
                                ? 'Stack'
                                : 'Component Stack';
                            }
                            fakeError.stack =
                              (enableOwnerStacks
                                ? 'Error Stack:'
                                : 'Error Component Stack:') + componentStack;
                            if (alreadyHasComponentStack) {
                              if (
                                areStackTracesEqual(
                                  args[args.length - 1],
                                  componentStack
                                )
                              ) {
                                var firstArg = args[0];
                                if (
                                  args.length > 1 &&
                                  typeof firstArg === 'string' &&
                                  firstArg.endsWith('%s')
                                ) {
                                  args[0] = firstArg.slice(
                                    0,
                                    firstArg.length - 2
                                  );
                                }
                                args[args.length - 1] = fakeError;
                                injectedComponentStackAsFakeError = true;
                              }
                            } else {
                              args.push(fakeError);
                              injectedComponentStackAsFakeError = true;
                            }
                          }
                          break;
                        }
                      }
                    } catch (error) {
                      setTimeout(function () {
                        throw error;
                      }, 0);
                    }
                  }
                } catch (err) {
                  _iterator.e(err);
                } finally {
                  _iterator.f();
                }
                if (settings.breakOnConsoleErrors) {
                  debugger;
                }
                if (isRunningDuringStrictModeInvocation) {
                  if (false) {
                    var argsWithCSSStyles;
                  } else {
                    originalMethod.apply(
                      undefined,
                      [
                        injectedComponentStackAsFakeError
                          ? ANSI_STYLE_DIMMING_TEMPLATE_WITH_COMPONENT_STACK
                          : ANSI_STYLE_DIMMING_TEMPLATE,
                      ].concat(
                        hook_toConsumableArray(
                          formatConsoleArguments.apply(undefined, args)
                        )
                      )
                    );
                  }
                } else {
                  originalMethod.apply(undefined, args);
                }
              };
              targetConsole[method] = overrideMethod;
            };
            for (
              var _i2 = 0,
                _consoleMethodsToOver2 =
                  consoleMethodsToOverrideForErrorsAndWarnings;
              _i2 < _consoleMethodsToOver2.length;
              _i2++
            ) {
              _loop2();
            }
          }
          var fiberRoots = {};
          var rendererInterfaces = new Map();
          var listeners = {};
          var renderers = new Map();
          var backends = new Map();
          var hook = {
            rendererInterfaces,
            listeners,
            backends,
            renderers,
            hasUnsupportedRendererAttached: false,
            emit,
            getFiberRoots,
            inject,
            on,
            off,
            sub,
            supportsFiber: true,
            supportsFlight: true,
            checkDCE,
            onCommitFiberUnmount,
            onCommitFiberRoot,
            onPostCommitFiberRoot,
            setStrictMode,
            getInternalModuleRanges,
            registerInternalModuleStart,
            registerInternalModuleStop,
          };
          if (maybeSettingsOrSettingsPromise == null) {
            hook.settings = {
              appendComponentStack: true,
              breakOnConsoleErrors: false,
              showInlineWarningsAndErrors: true,
              hideConsoleLogsInStrictMode: false,
            };
            patchConsoleForErrorsAndWarnings();
          } else {
            Promise.resolve(maybeSettingsOrSettingsPromise)
              .then(function (settings) {
                hook.settings = settings;
                hook.emit('settingsInitialized', settings);
                patchConsoleForErrorsAndWarnings();
              })
              .catch(function () {
                targetConsole.error(
                  "React DevTools failed to get Console Patching settings. Console won't be patched and some console features will not work."
                );
              });
          }
          Object.defineProperty(target, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
            configurable: false,
            enumerable: false,
            get: function get() {
              return hook;
            },
          });
          return hook;
        }
        function initBackend(
          hook,
          agent2,
          global2,
          isReloadAndProfileSupported
        ) {
          if (hook == null) {
            return function () {};
          }
          function registerRendererInterface(id, rendererInterface) {
            agent2.registerRendererInterface(id, rendererInterface);
            rendererInterface.flushInitialOperations();
          }
          var subs = [
            hook.sub('renderer-attached', function (_ref) {
              var { id, rendererInterface } = _ref;
              registerRendererInterface(id, rendererInterface);
            }),
            hook.sub('unsupported-renderer-version', function () {
              agent2.onUnsupportedRenderer();
            }),
            hook.sub('fastRefreshScheduled', agent2.onFastRefreshScheduled),
            hook.sub('operations', agent2.onHookOperations),
            hook.sub('traceUpdates', agent2.onTraceUpdates),
            hook.sub('settingsInitialized', agent2.onHookSettings),
          ];
          agent2.addListener('getIfHasUnsupportedRendererVersion', function () {
            if (hook.hasUnsupportedRendererAttached) {
              agent2.onUnsupportedRenderer();
            }
          });
          hook.rendererInterfaces.forEach(function (rendererInterface, id) {
            registerRendererInterface(id, rendererInterface);
          });
          hook.emit('react-devtools', agent2);
          hook.reactDevtoolsAgent = agent2;
          var onAgentShutdown = function onAgentShutdown() {
            subs.forEach(function (fn) {
              return fn();
            });
            hook.rendererInterfaces.forEach(function (rendererInterface) {
              rendererInterface.cleanup();
            });
            hook.reactDevtoolsAgent = null;
          };
          agent2.addListener('shutdown', onAgentShutdown);
          agent2.addListener('updateHookSettings', function (settings) {
            hook.settings = settings;
          });
          agent2.addListener('getHookSettings', function () {
            if (hook.settings != null) {
              agent2.onHookSettings(hook.settings);
            }
          });
          if (isReloadAndProfileSupported) {
            agent2.onReloadAndProfileSupportedByHost();
          }
          return function () {
            subs.forEach(function (fn) {
              return fn();
            });
          };
        }
        function resolveBoxStyle(prefix2, style) {
          var hasParts = false;
          var result = {
            bottom: 0,
            left: 0,
            right: 0,
            top: 0,
          };
          var styleForAll = style[prefix2];
          if (styleForAll != null) {
            for (
              var _i = 0, _Object$keys = Object.keys(result);
              _i < _Object$keys.length;
              _i++
            ) {
              var key = _Object$keys[_i];
              result[key] = styleForAll;
            }
            hasParts = true;
          }
          var styleForHorizontal = style[prefix2 + 'Horizontal'];
          if (styleForHorizontal != null) {
            result.left = styleForHorizontal;
            result.right = styleForHorizontal;
            hasParts = true;
          } else {
            var styleForLeft = style[prefix2 + 'Left'];
            if (styleForLeft != null) {
              result.left = styleForLeft;
              hasParts = true;
            }
            var styleForRight = style[prefix2 + 'Right'];
            if (styleForRight != null) {
              result.right = styleForRight;
              hasParts = true;
            }
            var styleForEnd = style[prefix2 + 'End'];
            if (styleForEnd != null) {
              result.right = styleForEnd;
              hasParts = true;
            }
            var styleForStart = style[prefix2 + 'Start'];
            if (styleForStart != null) {
              result.left = styleForStart;
              hasParts = true;
            }
          }
          var styleForVertical = style[prefix2 + 'Vertical'];
          if (styleForVertical != null) {
            result.bottom = styleForVertical;
            result.top = styleForVertical;
            hasParts = true;
          } else {
            var styleForBottom = style[prefix2 + 'Bottom'];
            if (styleForBottom != null) {
              result.bottom = styleForBottom;
              hasParts = true;
            }
            var styleForTop = style[prefix2 + 'Top'];
            if (styleForTop != null) {
              result.top = styleForTop;
              hasParts = true;
            }
          }
          return hasParts ? result : null;
        }
        function setupNativeStyleEditor_typeof(obj) {
          '@babel/helpers - typeof';
          if (
            typeof Symbol === 'function' &&
            typeof Symbol.iterator === 'symbol'
          ) {
            setupNativeStyleEditor_typeof = function _typeof(obj2) {
              return typeof obj2;
            };
          } else {
            setupNativeStyleEditor_typeof = function _typeof(obj2) {
              return obj2 &&
                typeof Symbol === 'function' &&
                obj2.constructor === Symbol &&
                obj2 !== Symbol.prototype
                ? 'symbol'
                : typeof obj2;
            };
          }
          return setupNativeStyleEditor_typeof(obj);
        }
        function setupNativeStyleEditor_defineProperty(obj, key, value) {
          if (key in obj) {
            Object.defineProperty(obj, key, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          } else {
            obj[key] = value;
          }
          return obj;
        }
        function setupNativeStyleEditor(
          bridge,
          agent2,
          resolveNativeStyle,
          validAttributes
        ) {
          bridge.addListener('NativeStyleEditor_measure', function (_ref) {
            var { id, rendererID } = _ref;
            measureStyle(agent2, bridge, resolveNativeStyle, id, rendererID);
          });
          bridge.addListener(
            'NativeStyleEditor_renameAttribute',
            function (_ref2) {
              var { id, rendererID, oldName, newName, value } = _ref2;
              renameStyle(agent2, id, rendererID, oldName, newName, value);
              setTimeout(function () {
                return measureStyle(
                  agent2,
                  bridge,
                  resolveNativeStyle,
                  id,
                  rendererID
                );
              });
            }
          );
          bridge.addListener('NativeStyleEditor_setValue', function (_ref3) {
            var { id, rendererID, name, value } = _ref3;
            setStyle(agent2, id, rendererID, name, value);
            setTimeout(function () {
              return measureStyle(
                agent2,
                bridge,
                resolveNativeStyle,
                id,
                rendererID
              );
            });
          });
          bridge.send('isNativeStyleEditorSupported', {
            isSupported: true,
            validAttributes,
          });
        }
        var EMPTY_BOX_STYLE = {
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        };
        var componentIDToStyleOverrides = new Map();
        function measureStyle(
          agent2,
          bridge,
          resolveNativeStyle,
          id,
          rendererID
        ) {
          var data = agent2.getInstanceAndStyle({
            id,
            rendererID,
          });
          if (!data || !data.style) {
            bridge.send('NativeStyleEditor_styleAndLayout', {
              id,
              layout: null,
              style: null,
            });
            return;
          }
          var { instance, style } = data;
          var resolvedStyle = resolveNativeStyle(style);
          var styleOverrides = componentIDToStyleOverrides.get(id);
          if (styleOverrides != null) {
            resolvedStyle = Object.assign({}, resolvedStyle, styleOverrides);
          }
          if (!instance || typeof instance.measure !== 'function') {
            bridge.send('NativeStyleEditor_styleAndLayout', {
              id,
              layout: null,
              style: resolvedStyle || null,
            });
            return;
          }
          instance.measure(function (x, y, width, height, left, top) {
            if (typeof x !== 'number') {
              bridge.send('NativeStyleEditor_styleAndLayout', {
                id,
                layout: null,
                style: resolvedStyle || null,
              });
              return;
            }
            var margin =
              (resolvedStyle != null &&
                resolveBoxStyle('margin', resolvedStyle)) ||
              EMPTY_BOX_STYLE;
            var padding =
              (resolvedStyle != null &&
                resolveBoxStyle('padding', resolvedStyle)) ||
              EMPTY_BOX_STYLE;
            bridge.send('NativeStyleEditor_styleAndLayout', {
              id,
              layout: {
                x,
                y,
                width,
                height,
                left,
                top,
                margin,
                padding,
              },
              style: resolvedStyle || null,
            });
          });
        }
        function shallowClone(object) {
          var cloned = {};
          for (var n in object) {
            cloned[n] = object[n];
          }
          return cloned;
        }
        function renameStyle(agent2, id, rendererID, oldName, newName, value) {
          var _ref4;
          var data = agent2.getInstanceAndStyle({
            id,
            rendererID,
          });
          if (!data || !data.style) {
            return;
          }
          var { instance, style } = data;
          var newStyle = newName
            ? ((_ref4 = {}),
              setupNativeStyleEditor_defineProperty(_ref4, oldName, undefined),
              setupNativeStyleEditor_defineProperty(_ref4, newName, value),
              _ref4)
            : setupNativeStyleEditor_defineProperty({}, oldName, undefined);
          var customStyle;
          if (
            instance !== null &&
            typeof instance.setNativeProps === 'function'
          ) {
            var styleOverrides = componentIDToStyleOverrides.get(id);
            if (!styleOverrides) {
              componentIDToStyleOverrides.set(id, newStyle);
            } else {
              Object.assign(styleOverrides, newStyle);
            }
            instance.setNativeProps({
              style: newStyle,
            });
          } else if (src_isArray(style)) {
            var lastIndex = style.length - 1;
            if (
              setupNativeStyleEditor_typeof(style[lastIndex]) === 'object' &&
              !src_isArray(style[lastIndex])
            ) {
              customStyle = shallowClone(style[lastIndex]);
              delete customStyle[oldName];
              if (newName) {
                customStyle[newName] = value;
              } else {
                customStyle[oldName] = undefined;
              }
              agent2.overrideValueAtPath({
                type: 'props',
                id,
                rendererID,
                path: ['style', lastIndex],
                value: customStyle,
              });
            } else {
              agent2.overrideValueAtPath({
                type: 'props',
                id,
                rendererID,
                path: ['style'],
                value: style.concat([newStyle]),
              });
            }
          } else if (setupNativeStyleEditor_typeof(style) === 'object') {
            customStyle = shallowClone(style);
            delete customStyle[oldName];
            if (newName) {
              customStyle[newName] = value;
            } else {
              customStyle[oldName] = undefined;
            }
            agent2.overrideValueAtPath({
              type: 'props',
              id,
              rendererID,
              path: ['style'],
              value: customStyle,
            });
          } else {
            agent2.overrideValueAtPath({
              type: 'props',
              id,
              rendererID,
              path: ['style'],
              value: [style, newStyle],
            });
          }
          agent2.emit('hideNativeHighlight');
        }
        function setStyle(agent2, id, rendererID, name, value) {
          var data = agent2.getInstanceAndStyle({
            id,
            rendererID,
          });
          if (!data || !data.style) {
            return;
          }
          var { instance, style } = data;
          var newStyle = setupNativeStyleEditor_defineProperty({}, name, value);
          if (
            instance !== null &&
            typeof instance.setNativeProps === 'function'
          ) {
            var styleOverrides = componentIDToStyleOverrides.get(id);
            if (!styleOverrides) {
              componentIDToStyleOverrides.set(id, newStyle);
            } else {
              Object.assign(styleOverrides, newStyle);
            }
            instance.setNativeProps({
              style: newStyle,
            });
          } else if (src_isArray(style)) {
            var lastLength = style.length - 1;
            if (
              setupNativeStyleEditor_typeof(style[lastLength]) === 'object' &&
              !src_isArray(style[lastLength])
            ) {
              agent2.overrideValueAtPath({
                type: 'props',
                id,
                rendererID,
                path: ['style', lastLength, name],
                value,
              });
            } else {
              agent2.overrideValueAtPath({
                type: 'props',
                id,
                rendererID,
                path: ['style'],
                value: style.concat([newStyle]),
              });
            }
          } else {
            agent2.overrideValueAtPath({
              type: 'props',
              id,
              rendererID,
              path: ['style'],
              value: [style, newStyle],
            });
          }
          agent2.emit('hideNativeHighlight');
        }
        var savedComponentFilters = getDefaultComponentFilters();
        function backend_debug(methodName) {
          if (__DEBUG__) {
            var _console;
            for (
              var _len = arguments.length,
                args = new Array(_len > 1 ? _len - 1 : 0),
                _key = 1;
              _key < _len;
              _key++
            ) {
              args[_key - 1] = arguments[_key];
            }
            (_console = console).log.apply(
              _console,
              [
                '%c[core/backend] %c'.concat(methodName),
                'color: teal; font-weight: bold;',
                'font-weight: bold;',
              ].concat(args)
            );
          }
        }
        function backend_initialize(maybeSettingsOrSettingsPromise) {
          var shouldStartProfilingNow =
            arguments.length > 1 && arguments[1] !== undefined
              ? arguments[1]
              : false;
          var profilingSettings =
            arguments.length > 2 ? arguments[2] : undefined;
          installHook(
            window,
            maybeSettingsOrSettingsPromise,
            shouldStartProfilingNow,
            profilingSettings
          );
        }
        function connectToDevTools(options) {
          var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
          if (hook == null) {
            return;
          }
          var _ref = options || {},
            _ref$host = _ref.host,
            host = _ref$host === undefined ? 'localhost' : _ref$host,
            nativeStyleEditorValidAttributes =
              _ref.nativeStyleEditorValidAttributes,
            _ref$useHttps = _ref.useHttps,
            useHttps = _ref$useHttps === undefined ? false : _ref$useHttps,
            _ref$port = _ref.port,
            port = _ref$port === undefined ? 8097 : _ref$port,
            websocket = _ref.websocket,
            _ref$resolveRNStyle = _ref.resolveRNStyle,
            resolveRNStyle =
              _ref$resolveRNStyle === undefined ? null : _ref$resolveRNStyle,
            _ref$retryConnectionD = _ref.retryConnectionDelay,
            retryConnectionDelay =
              _ref$retryConnectionD === undefined
                ? 2000
                : _ref$retryConnectionD,
            _ref$isAppActive = _ref.isAppActive,
            isAppActive =
              _ref$isAppActive === undefined
                ? function () {
                    return true;
                  }
                : _ref$isAppActive,
            onSettingsUpdated = _ref.onSettingsUpdated,
            _ref$isReloadAndProfi = _ref.isReloadAndProfileSupported,
            isReloadAndProfileSupported =
              _ref$isReloadAndProfi === undefined
                ? getIsReloadAndProfileSupported()
                : _ref$isReloadAndProfi,
            isProfiling = _ref.isProfiling,
            onReloadAndProfile2 = _ref.onReloadAndProfile,
            onReloadAndProfileFlagsReset2 = _ref.onReloadAndProfileFlagsReset;
          var protocol = useHttps ? 'wss' : 'ws';
          var retryTimeoutID = null;
          function scheduleRetry() {
            if (retryTimeoutID === null) {
              retryTimeoutID = setTimeout(function () {
                return connectToDevTools(options);
              }, retryConnectionDelay);
            }
          }
          if (!isAppActive()) {
            scheduleRetry();
            return;
          }
          var bridge = null;
          var messageListeners = [];
          var uri = protocol + '://' + host + ':' + port;
          var ws = websocket ? websocket : new window.WebSocket(uri);
          ws.onclose = handleClose;
          ws.onerror = handleFailed;
          ws.onmessage = handleMessage;
          ws.onopen = function () {
            bridge = new src_bridge({
              listen: function listen(fn) {
                messageListeners.push(fn);
                return function () {
                  var index = messageListeners.indexOf(fn);
                  if (index >= 0) {
                    messageListeners.splice(index, 1);
                  }
                };
              },
              send: function send(event, payload, transferable) {
                if (ws.readyState === ws.OPEN) {
                  if (__DEBUG__) {
                    backend_debug('wall.send()', event, payload);
                  }
                  ws.send(
                    JSON.stringify({
                      event,
                      payload,
                    })
                  );
                } else {
                  if (__DEBUG__) {
                    backend_debug(
                      'wall.send()',
                      'Shutting down bridge because of closed WebSocket connection'
                    );
                  }
                  if (bridge !== null) {
                    bridge.shutdown();
                  }
                  scheduleRetry();
                }
              },
            });
            bridge.addListener(
              'updateComponentFilters',
              function (componentFilters) {
                savedComponentFilters = componentFilters;
              }
            );
            if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {
              bridge.send('overrideComponentFilters', savedComponentFilters);
            }
            var agent2 = new Agent(bridge, isProfiling, onReloadAndProfile2);
            if (typeof onReloadAndProfileFlagsReset2 === 'function') {
              onReloadAndProfileFlagsReset2();
            }
            if (onSettingsUpdated != null) {
              agent2.addListener('updateHookSettings', onSettingsUpdated);
            }
            agent2.addListener('shutdown', function () {
              if (onSettingsUpdated != null) {
                agent2.removeListener('updateHookSettings', onSettingsUpdated);
              }
              hook.emit('shutdown');
            });
            initBackend(hook, agent2, window, isReloadAndProfileSupported);
            if (resolveRNStyle != null || hook.resolveRNStyle != null) {
              setupNativeStyleEditor(
                bridge,
                agent2,
                resolveRNStyle || hook.resolveRNStyle,
                nativeStyleEditorValidAttributes ||
                  hook.nativeStyleEditorValidAttributes ||
                  null
              );
            } else {
              var lazyResolveRNStyle;
              var lazyNativeStyleEditorValidAttributes;
              var initAfterTick = function initAfterTick() {
                if (bridge !== null) {
                  setupNativeStyleEditor(
                    bridge,
                    agent2,
                    lazyResolveRNStyle,
                    lazyNativeStyleEditorValidAttributes
                  );
                }
              };
              if (!hook.hasOwnProperty('resolveRNStyle')) {
                Object.defineProperty(hook, 'resolveRNStyle', {
                  enumerable: false,
                  get: function get() {
                    return lazyResolveRNStyle;
                  },
                  set: function set(value) {
                    lazyResolveRNStyle = value;
                    initAfterTick();
                  },
                });
              }
              if (!hook.hasOwnProperty('nativeStyleEditorValidAttributes')) {
                Object.defineProperty(
                  hook,
                  'nativeStyleEditorValidAttributes',
                  {
                    enumerable: false,
                    get: function get() {
                      return lazyNativeStyleEditorValidAttributes;
                    },
                    set: function set(value) {
                      lazyNativeStyleEditorValidAttributes = value;
                      initAfterTick();
                    },
                  }
                );
              }
            }
          };
          function handleClose() {
            if (__DEBUG__) {
              backend_debug('WebSocket.onclose');
            }
            if (bridge !== null) {
              bridge.emit('shutdown');
            }
            scheduleRetry();
          }
          function handleFailed() {
            if (__DEBUG__) {
              backend_debug('WebSocket.onerror');
            }
            scheduleRetry();
          }
          function handleMessage(event) {
            var data;
            try {
              if (typeof event.data === 'string') {
                data = JSON.parse(event.data);
                if (__DEBUG__) {
                  backend_debug('WebSocket.onmessage', data);
                }
              } else {
                throw Error();
              }
            } catch (e) {
              console.error(
                '[React DevTools] Failed to parse JSON: ' + event.data
              );
              return;
            }
            messageListeners.forEach(function (fn) {
              try {
                fn(data);
              } catch (error) {
                console.log('[React DevTools] Error calling listener', data);
                console.log('error:', error);
                throw error;
              }
            });
          }
        }
        function connectWithCustomMessagingProtocol(_ref2) {
          var {
              onSubscribe,
              onUnsubscribe,
              onMessage,
              nativeStyleEditorValidAttributes,
              resolveRNStyle,
              onSettingsUpdated,
              isReloadAndProfileSupported: _ref2$isReloadAndProf,
            } = _ref2,
            isReloadAndProfileSupported =
              _ref2$isReloadAndProf === undefined
                ? getIsReloadAndProfileSupported()
                : _ref2$isReloadAndProf,
            isProfiling = _ref2.isProfiling,
            onReloadAndProfile2 = _ref2.onReloadAndProfile,
            onReloadAndProfileFlagsReset2 = _ref2.onReloadAndProfileFlagsReset;
          var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
          if (hook == null) {
            return;
          }
          var wall = {
            listen: function listen(fn) {
              onSubscribe(fn);
              return function () {
                onUnsubscribe(fn);
              };
            },
            send: function send(event, payload) {
              onMessage(event, payload);
            },
          };
          var bridge = new src_bridge(wall);
          bridge.addListener(
            'updateComponentFilters',
            function (componentFilters) {
              savedComponentFilters = componentFilters;
            }
          );
          if (window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ == null) {
            bridge.send('overrideComponentFilters', savedComponentFilters);
          }
          var agent2 = new Agent(bridge, isProfiling, onReloadAndProfile2);
          if (typeof onReloadAndProfileFlagsReset2 === 'function') {
            onReloadAndProfileFlagsReset2();
          }
          if (onSettingsUpdated != null) {
            agent2.addListener('updateHookSettings', onSettingsUpdated);
          }
          agent2.addListener('shutdown', function () {
            if (onSettingsUpdated != null) {
              agent2.removeListener('updateHookSettings', onSettingsUpdated);
            }
            hook.emit('shutdown');
          });
          var unsubscribeBackend = initBackend(
            hook,
            agent2,
            window,
            isReloadAndProfileSupported
          );
          var nativeStyleResolver = resolveRNStyle || hook.resolveRNStyle;
          if (nativeStyleResolver != null) {
            var validAttributes =
              nativeStyleEditorValidAttributes ||
              hook.nativeStyleEditorValidAttributes ||
              null;
            setupNativeStyleEditor(
              bridge,
              agent2,
              nativeStyleResolver,
              validAttributes
            );
          }
          return unsubscribeBackend;
        }
      })();
      return __webpack_exports__;
    })();
  });
});

// node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);
var wrapper_default = import_websocket.default;

// node_modules/ink/build/devtools-window-polyfill.js
var customGlobal = global;
if (!customGlobal.WebSocket) {
  customGlobal.WebSocket = wrapper_default;
}
if (!customGlobal.window) {
  customGlobal.window = global;
}
if (!customGlobal.self) {
  customGlobal.self = global;
}
customGlobal.window.__REACT_DEVTOOLS_COMPONENT_FILTERS__ = [
  {
    type: 1,
    value: 7,
    isEnabled: true,
  },
  {
    type: 2,
    value: 'InternalApp',
    isEnabled: true,
    isValid: true,
  },
  {
    type: 2,
    value: 'InternalAppContext',
    isEnabled: true,
    isValid: true,
  },
  {
    type: 2,
    value: 'InternalStdoutContext',
    isEnabled: true,
    isValid: true,
  },
  {
    type: 2,
    value: 'InternalStderrContext',
    isEnabled: true,
    isValid: true,
  },
  {
    type: 2,
    value: 'InternalStdinContext',
    isEnabled: true,
    isValid: true,
  },
  {
    type: 2,
    value: 'InternalFocusContext',
    isEnabled: true,
    isValid: true,
  },
];

// node_modules/ink/build/devtools.js
var import_react_devtools_core = __toESM(require_backend(), 1);
import_react_devtools_core.default.connectToDevTools();
