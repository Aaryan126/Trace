const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

export function encodeNativeMessage(value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function readNativeMessage(stream) {
  return new Promise((resolve, reject) => {
    let input = Buffer.alloc(0);
    let expectedLength = null;

    const cleanup = () => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };

    const fail = (error) => {
      cleanup();
      reject(error);
    };

    const onData = (chunk) => {
      input = Buffer.concat([input, chunk]);
      if (expectedLength === null && input.length >= 4) {
        expectedLength = input.readUInt32LE(0);
        if (expectedLength <= 0 || expectedLength > MAX_MESSAGE_BYTES) {
          fail(new Error('Invalid native message length'));
          return;
        }
      }
      if (expectedLength === null || input.length < expectedLength + 4) return;

      cleanup();
      try {
        resolve(JSON.parse(input.subarray(4, expectedLength + 4).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    };

    const onEnd = () => fail(new Error(input.length < 4 ? 'Missing native message header' : 'Incomplete native message'));
    const onError = (error) => fail(error);

    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}
