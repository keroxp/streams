const test = require('tape');

test('Using the reader directly on a mundane stream', t => {
  t.plan(22);

  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      setTimeout(() => enqueue('b'), 30);
      setTimeout(close, 60);
    }
  });

  t.equal(rs.state, 'readable', 'stream starts out readable');

  const reader = rs.getReader();

  t.equal(reader.isActive, true, 'reader isActive is true');

  t.equal(rs.state, 'waiting', 'after getting a reader, the stream state is waiting');
  t.equal(reader.state, 'readable', 'the reader state is readable');

  t.throws(() => rs.read(), /TypeError/, 'trying to read from the stream directly throws a TypeError');
  t.equal(reader.read(), 'a', 'trying to read from the reader works and gives back the first enqueued value');
  t.equal(reader.state, 'waiting', 'the reader state is now waiting since the queue has been drained');
  rs.cancel().then(
    () => t.fail('cancel() should not be fulfilled'),
    e => t.equal(e.constructor, TypeError, 'cancel() should be rejected with a TypeError')
  );

  reader.ready.then(() => {
    t.equal(reader.state, 'readable', 'ready for reader is fulfilled when second chunk is enqueued');
    t.equal(rs.state, 'waiting', 'the stream state is still waiting');
    t.equal(reader.read(), 'b', 'you can read the second chunk from the reader');
  });

  reader.closed.then(() => {
    t.pass('closed for the reader is fulfilled');
    t.equal(reader.state, 'closed', 'the reader state is closed');
    t.equal(rs.state, 'closed', 'the stream state is closed');
    t.equal(reader.isActive, false, 'the reader is no longer active');

    t.doesNotThrow(() => reader.releaseLock(), 'trying to release the lock twice does nothing');
  });

  rs.ready.then(() => {
    t.equal(rs.state, 'closed', 'ready for stream is not fulfilled until the stream closes');
    t.equal(reader.isActive, false, 'the reader is no longer active after the stream has closed');
  });

  rs.closed.then(() => {
    t.pass('closed for the stream is fulfilled');
    t.equal(rs.state, 'closed', 'the stream state is closed');
    t.equal(reader.state, 'closed', 'the reader state is closed');
    t.equal(reader.isActive, false, 'the reader is no longer active');
  });
});

test('Reading from a reader for an empty stream throws but doesn\'t break anything', t => {
  let enqueue;
  const rs = new ReadableStream({
    start(e) {
      enqueue = e;
    }
  });
  const reader = rs.getReader();

  t.equal(reader.isActive, true, 'reader is active to start with');
  t.equal(reader.state, 'waiting', 'reader state is waiting to start with');
  t.throws(() => reader.read(), /TypeError/, 'calling reader.read() throws a TypeError');
  t.equal(reader.isActive, true, 'reader is still active');
  t.equal(reader.state, 'waiting', 'reader state is still waiting');

  enqueue('a');

  reader.ready.then(() => {
    t.equal(reader.state, 'readable', 'after enqueuing the reader state is readable');
    t.equal(reader.read(), 'a', 'the enqueued chunk can be read back through the reader');
    t.end();
  });
});

test('A released reader should present like a closed stream', t => {
  t.plan(7);

  const rs = new ReadableStream();
  const reader = rs.getReader();
  reader.releaseLock();

  t.equal(reader.isActive, false, 'isActive returns false');
  t.equal(reader.state, 'closed', 'reader.state returns closed');
  t.equal(rs.state, 'waiting', 'rs.state returns waiting');

  t.throws(() => reader.read(), /TypeError/, 'trying to read gives a TypeError');
  reader.cancel().then(
    v => t.equal(v, undefined, 'reader.cancel() should fulfill with undefined'),
    e => t.fail('reader.cancel() should not reject')
  );

  reader.ready.then(() => t.pass('reader.ready should be fulfilled'));
  reader.closed.then(() => t.pass('reader.closed should be fulfilled'));
});

test('cancel() on a reader implicitly releases the reader before calling through', t => {
  t.plan(3);

  const passedReason = new Error('it wasn\'t the right time, sorry');
  const rs = new ReadableStream({
    cancel(reason) {
      t.equal(reader.isActive, false, 'canceling via the reader should release the reader\'s lock');
      t.equal(reason, passedReason, 'the cancellation reason is passed through to the underlying source');
    }
  });

  const reader = rs.getReader();
  reader.cancel(passedReason).then(
    () => t.pass('reader.cancel() should fulfill'),
    e => t.fail('reader.cancel() should not reject')
  );
});

test('getReader() on a closed stream should fail', t => {
  const rs = new ReadableStream({
    start(enqueue, close) {
      close();
    }
  });

  t.equal(rs.state, 'closed', 'the stream should be closed');
  t.throws(() => rs.getReader(), /TypeError/, 'getReader() threw a TypeError');
  t.end();
});

test('getReader() on a cancelled stream should fail (since cancelling closes)', t => {
  const rs = new ReadableStream();
  rs.cancel(new Error('fun time is over'));

  t.equal(rs.state, 'closed', 'the stream should be closed');
  t.throws(() => rs.getReader(), /TypeError/, 'getReader() threw a TypeError');
  t.end();
});

test('getReader() on an errored stream should rethrow the error', t => {
  const theError = new Error('don\'t say i didn\'t warn ya');
  const rs = new ReadableStream({
    start(enqueue, close, error) {
      error(theError);
    }
  });

  t.equal(rs.state, 'errored', 'the stream should be errored');
  t.throws(() => rs.getReader(), /don't say i didn't warn ya/, 'getReader() threw the error');
  t.end();
});

test('closed should be fulfilled after stream is closed (both .closed accesses after acquiring)', t => {
  t.plan(2);

  let doClose;
  const rs = new ReadableStream({
    start(enqueue, close) {
      doClose = close;
    }
  });

  const reader = rs.getReader();
  doClose();

  reader.closed.then(() => {
    t.equal(reader.isActive, false, 'reader is no longer active when reader closed is fulfilled');
  });

  rs.closed.then(() => {
    t.equal(reader.isActive, false, 'reader is no longer active when stream closed is fulfilled');
  });
});

test('closed should be fulfilled after stream is closed (stream .closed access before acquiring)', t => {
  t.plan(2);

  let doClose;
  const rs = new ReadableStream({
    start(enqueue, close) {
      doClose = close;
    }
  });

  rs.closed.then(() => {
    t.equal(reader.isActive, false, 'reader is no longer active when stream closed is fulfilled');
  });

  const reader = rs.getReader();
  doClose();

  reader.closed.then(() => {
    t.equal(reader.isActive, false, 'reader is no longer active when reader closed is fulfilled');
  });
});

test('reader.closed should be fulfilled after reader releases its lock (.closed access before release)', t => {
  const rs = new ReadableStream();
  const reader = rs.getReader();
  reader.closed.then(() => t.end());
  reader.releaseLock();
});

test('reader.closed should be fulfilled after reader releases its lock (.closed access after release)', t => {
  const rs = new ReadableStream();
  const reader = rs.getReader();
  reader.releaseLock();
  reader.closed.then(() => t.end());
});

test('closed should be fulfilled after reader releases its lock (multiple stream locks)', t => {
  t.plan(6);

  let doClose;
  const rs = new ReadableStream({
    start(enqueue, close) {
      doClose = close;
    }
  });

  const reader1 = rs.getReader();

  rs.closed.then(() => {
    t.equal(reader1.isActive, false, 'reader1 is no longer active when stream closed is fulfilled');
    t.equal(reader2.isActive, false, 'reader2 is no longer active when stream closed is fulfilled');
  });

  reader1.releaseLock();

  const reader2 = rs.getReader();
  doClose();

  reader1.closed.then(() => {
    t.equal(reader1.isActive, false, 'reader1 is no longer active when reader1 closed is fulfilled');
    t.equal(reader2.isActive, false, 'reader2 is no longer active when reader1 closed is fulfilled');
  });

  reader2.closed.then(() => {
    t.equal(reader1.isActive, false, 'reader1 is no longer active when reader2 closed is fulfilled');
    t.equal(reader2.isActive, false, 'reader2 is no longer active when reader2 closed is fulfilled');
  });
});

test('ready should fulfill after reader releases its lock and stream is waiting (.ready access before releasing)',
    t => {
  t.plan(5);

  const rs = new ReadableStream();
  const reader = rs.getReader();

  t.equal(rs.state, 'waiting', 'the stream\'s state is initially waiting');
  t.equal(reader.state, 'waiting', 'the reader\'s state is initially waiting');
  reader.ready.then(() => {
    t.pass('reader ready should be fulfilled');
    t.equal(rs.state, 'waiting', 'the stream\'s state is still waiting');
    t.equal(reader.state, 'closed', 'the reader\'s state is now closed');
  });
  reader.releaseLock();
});

test('ready should fulfill after reader releases its lock and stream is waiting (.ready access after releasing)',
    t => {
  t.plan(5);

  const rs = new ReadableStream();
  const reader = rs.getReader();

  t.equal(rs.state, 'waiting', 'the stream\'s state is initially waiting');
  t.equal(reader.state, 'waiting', 'the reader\'s state is initially waiting');
  reader.releaseLock();
  reader.ready.then(() => {
    t.pass('reader ready should be fulfilled');
    t.equal(rs.state, 'waiting', 'the stream\'s state is still waiting');
    t.equal(reader.state, 'closed', 'the reader\'s state is now closed');
  });
});

test('stream\'s ready should not fulfill when acquiring, then releasing, a reader', t => {
  const rs = new ReadableStream();
  const reader = rs.getReader();

  rs.ready.then(() => t.fail('stream ready should not be fulfilled'));
  reader.releaseLock();

  setTimeout(() => t.end(), 20);
});

test('stream\'s ready should not fulfill while locked, even if accessed before locking', t => {
  let doEnqueue;
  const rs = new ReadableStream({
    start(enqueue) {
      doEnqueue = enqueue;
    }
  });
  const ready = rs.ready;

  const reader = rs.getReader();

  ready.then(() => {
    t.equal(rs.state, 'waiting', 'ready fulfilled but the state was waiting; next assert will fail');
    t.fail('stream ready should not be fulfilled');
  });

  doEnqueue();
  setTimeout(() => t.end(), 20);
});

test('stream\'s ready accessed before locking should not fulfill if stream becomes readable while locked, becomes ' +
    'waiting again and then is released', t => {
  let doEnqueue;
  const rs = new ReadableStream({
    start(enqueue) {
      doEnqueue = enqueue;
    }
  });
  const ready = rs.ready;

  const reader = rs.getReader();

  ready.then(() => {
    t.fail('stream ready should not be fulfilled');
  });

  doEnqueue();
  t.equal(reader.state, 'readable', 'reader should be readable after enqueue');
  reader.read();
  t.equal(reader.state, 'waiting', 'reader should be waiting again after read');
  reader.releaseLock();
  t.equal(rs.state, 'waiting', 'stream should be waiting again after read');
  setTimeout(() => t.end(), 20);
});

test('stream\'s ready accessed before locking should not fulfill if stream becomes readable while locked, becomes ' +
    'waiting again and then is released in another microtask', t => {
  let doEnqueue;
  const rs = new ReadableStream({
    start(enqueue) {
      doEnqueue = enqueue;
    }
  });
  const ready = rs.ready;

  const reader = rs.getReader();

  ready.then(() => {
    t.fail('stream ready should not be fulfilled');
  });

  doEnqueue();
  t.equal(reader.state, 'readable', 'reader should be readable after enqueue');
  reader.read();
  t.equal(reader.state, 'waiting', 'reader should be waiting again after read');

  // Let the fulfillment callback used in the algorithm of rs.ready run. This
  // covers the code path in rs.ready which is run when
  // this._readableStreamReader is not undefined.
  Promise.resolve().then(() => {
    reader.releaseLock();
    t.equal(rs.state, 'waiting', 'stream should be waiting again after read');
    setTimeout(() => t.end(), 20);
  });
});

test('stream\'s ready should not fulfill when acquiring a reader, accessing ready, releasing the reader, acquiring ' +
    'another reader, then enqueuing a chunk', t => {
  // https://github.com/whatwg/streams/pull/262#discussion_r22990833

  let doEnqueue;
  const rs = new ReadableStream({
    start(enqueue) {
      doEnqueue = enqueue;
    }
  });

  const reader = rs.getReader();
  rs.ready.then(() => {
    t.equal(rs.state, 'waiting', 'ready fulfilled but the state was waiting; next assert will fail');
    t.fail('stream ready should not be fulfilled')
  });

  reader.releaseLock();
  rs.getReader();
  doEnqueue('a');

  setTimeout(() => t.end(), 20);
});

test('Multiple readers can access the stream in sequence', t => {
  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      enqueue('b');
      enqueue('c');
      enqueue('d');
      enqueue('e');
      close();
    }
  });

  t.equal(rs.read(), 'a', 'reading the first chunk directly from the stream works');

  const reader1 = rs.getReader();
  t.equal(reader1.read(), 'b', 'reading the second chunk from reader1 works');
  reader1.releaseLock();
  t.equal(reader1.state, 'closed', 'reader1 is closed after being released');

  t.equal(rs.read(), 'c', 'reading the third chunk from the stream after releasing reader1 works');

  const reader2 = rs.getReader();
  t.equal(reader2.read(), 'd', 'reading the fourth chunk from reader2 works');
  reader2.releaseLock();
  t.equal(reader2.state, 'closed', 'reader2 is closed after being released');

  t.equal(rs.read(), 'e', 'reading the fifth chunk from the stream after releasing reader2 works');

  t.end();
});

test('A stream that errors has that reflected in the reader and the stream', t => {
  t.plan(9);

  let error;
  const rs = new ReadableStream({
    start(enqueue, close, error_) {
      error = error_;
    }
  });

  const reader = rs.getReader();

  const passedError = new Error('too exclusive');
  error(passedError);

  t.equal(reader.isActive, false, 'the reader should have lost its lock');
  t.throws(() => reader.read(), /TypeError/,
    'reader.read() should throw a TypeError since the reader no longer has a lock');
  t.equal(reader.state, 'errored', 'the reader\'s state should be errored');
  reader.ready.then(() => t.pass('reader.ready should fulfill'));
  reader.closed.then(
    () => t.fail('reader.closed should not be fulfilled'),
    e => t.equal(e, passedError, 'reader.closed should be rejected with the stream error')
  );

  t.throws(() => rs.read(), /too exclusive/, 'rs.read() should throw the stream error');
  t.equal(rs.state, 'errored', 'the stream\'s state should be errored');
  rs.ready.then(() => t.pass('rs.ready should fulfill'));
  rs.closed.then(
    () => t.fail('rs.closed should not be fulfilled'),
    e => t.equal(e, passedError, 'rs.closed should be rejected with the stream error')
  );
});

test('Cannot use an already-released reader to unlock a stream again', t => {
  t.plan(2);

  const rs = new ReadableStream();

  const reader1 = rs.getReader();
  reader1.releaseLock();

  const reader2 = rs.getReader();
  t.equal(reader2.isActive, true, 'reader2 state is active before releasing reader1');

  reader1.releaseLock();
  t.equal(reader2.isActive, true, 'reader2 state is still active after releasing reader1 again');
});

test('stream\'s ready returns the same instance as long as there\'s no state transition visible on stream even ' +
    'if the reader became readable while the stream was locked', t => {
  let enqueue;
  const rs = new ReadableStream({
    start(enqueue_) {
      enqueue = enqueue_
    }
  });

  const ready = rs.ready;

  const reader = rs.getReader();

  enqueue('a');
  t.equal(reader.state, 'readable', 'reader should be readable after enqueuing');
  t.equal(reader.read(), 'a', 'the enqueued data should be read');

  reader.releaseLock();

  t.equal(ready, rs.ready, 'rs.ready should return the same instance as before locking');
  t.end();
});

test('reader\'s ready and close returns the same instance as long as there\'s no state transition',
    t => {
  const rs = new ReadableStream();
  const reader = rs.getReader();

  const ready = reader.ready;
  const closed = reader.closed;

  reader.releaseLock();

  t.equal(ready, reader.ready, 'reader.ready should return the same instance as before releasing');
  t.equal(closed, reader.closed, 'reader.ready should return the same instance as before releasing');
  t.end();
});

test('reader\'s ready and close returns the same instance as long as there\'s no state transition to waiting',
    t => {
  let enqueue;
  const rs = new ReadableStream({
    start(enqueue_) {
      enqueue = enqueue_
    }
  });

  const reader = rs.getReader();

  const ready = reader.ready;
  const closed = reader.closed;

  enqueue('a');
  t.equal(reader.state, 'readable', 'reader should be readable after enqueuing');

  reader.releaseLock();

  t.equal(ready, reader.ready, 'reader.ready should return the same instance as before releasing');
  t.equal(closed, reader.closed, 'reader.ready should return the same instance as before releasing');
  t.end();
});
