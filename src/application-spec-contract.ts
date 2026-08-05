import { z } from 'zod';

export const APPLICATION_SPEC_FORMAT = 'explorbot-application-spec';
export const APPLICATION_SPEC_VERSION = 1;

export const APPLICATION_SPEC_PAGE_SCHEMA = z.object({
  format: z.literal(APPLICATION_SPEC_FORMAT),
  version: z.literal(APPLICATION_SPEC_VERSION),
  url: z.string().trim().min(1),
});
