import ReadableStream from '../../lib/readable-stream';
import WritableStream from '../../lib/writable-stream';

export default function duckTypedPassThroughTransform() {
  let enqueueInReadable;
  let closeReadable;

  return {
    writable: new WritableStream({
      write(chunk) {
        enqueueInReadable(chunk);
      },

      close() {
        closeReadable();
      }
    }),

    readable: new ReadableStream({
      start(enqueue, close) {
        enqueueInReadable = enqueue;
        closeReadable = close;
      }
    })
  };
}
