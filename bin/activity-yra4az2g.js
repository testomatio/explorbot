import './maclay-y62a35vv.js';

// src/activity.ts
class Activity {
  static instance;
  currentActivity = null;
  listeners = [];
  clearTimeoutId = null;
  constructor() {}
  static getInstance() {
    if (!Activity.instance) {
      Activity.instance = new Activity();
    }
    return Activity.instance;
  }
  setActivity(message, type = 'general') {
    if (this.clearTimeoutId) {
      clearTimeout(this.clearTimeoutId);
      this.clearTimeoutId = null;
    }
    this.currentActivity = {
      message,
      timestamp: new Date(),
      type,
    };
    this.notifyListeners();
  }
  clearActivity() {
    if (!this.clearTimeoutId && this.currentActivity) {
      const timeSinceActivity =
        Date.now() - this.currentActivity.timestamp.getTime();
      const minDisplayTime = 1000;
      if (timeSinceActivity < minDisplayTime) {
        this.clearTimeoutId = setTimeout(() => {
          this.currentActivity = null;
          this.notifyListeners();
          this.clearTimeoutId = null;
        }, minDisplayTime - timeSinceActivity);
      } else {
        this.currentActivity = null;
        this.notifyListeners();
      }
    }
  }
  getCurrentActivity() {
    return this.currentActivity;
  }
  addListener(listener) {
    this.listeners.push(listener);
    listener(this.currentActivity);
  }
  removeListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }
  notifyListeners() {
    this.listeners.forEach((listener) => listener(this.currentActivity));
  }
}
var activity = Activity.getInstance();
var setActivity = (message, type = 'general') => {
  activity.setActivity(message, type);
};
var clearActivity = () => {
  activity.clearActivity();
};
var getCurrentActivity = () => {
  return activity.getCurrentActivity();
};
var addActivityListener = (listener) => {
  activity.addListener(listener);
};
var removeActivityListener = (listener) => {
  activity.removeListener(listener);
};
var activity_default = Activity;
export {
  setActivity,
  removeActivityListener,
  getCurrentActivity,
  activity_default as default,
  clearActivity,
  addActivityListener,
};

export {
  setActivity,
  clearActivity,
  addActivityListener,
  removeActivityListener,
};
