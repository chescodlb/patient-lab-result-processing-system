import { Response as ExpressResponse } from 'express';

declare module 'express-serve-static-core' {
  interface Response {
    status(code: number): this;
  }
}