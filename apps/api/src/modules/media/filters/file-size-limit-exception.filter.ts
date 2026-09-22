import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  PayloadTooLargeException,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

/**
 * Maps Multer LIMIT_FILE_SIZE errors to HTTP 413 Payload Too Large.
 * Must be applied to the upload endpoint via @UseFilters() decorator.
 * Ensures AC #24: oversized file uploads return 413, not 400.
 */
@Catch(MulterError, PayloadTooLargeException)
export class FileSizeLimitExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError | PayloadTooLargeException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const isLimitError = exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE';
    const isPayloadTooLarge = exception instanceof PayloadTooLargeException;

    if (isLimitError || isPayloadTooLarge) {
      response.status(413).json({
        statusCode: 413,
        message: 'FILE_TOO_LARGE',
        error: 'Payload Too Large',
      });
      return;
    }

    // Re-throw anything that is not a size-limit error
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
    } else {
      response.status(500).json({ statusCode: 500, message: 'Internal server error' });
    }
  }
}
