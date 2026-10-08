// A minimal SMTP client: one message per connection, STARTTLS (587), implicit TLS
// (465) or plain for a relay on the same host, AUTH PLAIN or LOGIN. Certificates
// are always verified - against SMTP_TLS_SERVERNAME when the host is reached by a
// different name than the one in its certificate.

import net from 'node:net';
import tls from 'node:tls';

export class SmtpError extends Error {}

function createReader() {
  let buffer = '';
  let lines = [];
  const replies = [];
  let waiter = null;
  let failure = null;

  function deliver(reply) {
    if (waiter !== null) {
      const w = waiter;
      waiter = null;
      w.resolve(reply);
    }
    else {
      replies.push(reply);
    }
  }

  return {
    feed(chunk) {
      buffer += chunk.toString('utf8');
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        lines.push(line);
        // "250-..." continues a reply, "250 ..." or a bare "250" ends it
        if (/^\d{3}(?: |$)/.test(line)) {
          deliver({ code: Number(line.slice(0, 3)), lines });
          lines = [];
        }
      }
    },
    fail(error) {
      if (failure !== null) {
        return;
      }
      failure = error;
      if (waiter !== null) {
        const w = waiter;
        waiter = null;
        w.reject(error);
      }
    },
    next() {
      if (replies.length > 0) {
        return Promise.resolve(replies.shift());
      }
      if (failure !== null) {
        return Promise.reject(failure);
      }
      return new Promise((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
  };
}

function bind(socket, reader, timeoutMs) {
  const onData = (chunk) => reader.feed(chunk);
  const onError = (error) => reader.fail(new SmtpError(error.message));
  const onClose = () => reader.fail(new SmtpError('connection closed by the server'));
  socket.setTimeout(timeoutMs, () => {
    reader.fail(new SmtpError('timeout'));
    socket.destroy();
  });
  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);
  return () => {
    socket.off('data', onData);
    socket.off('error', onError);
    socket.off('close', onClose);
    socket.setTimeout(0);
  };
}

function extensions(reply) {
  return reply.lines.slice(1).map((line) => line.slice(4).toUpperCase());
}

export function createMailer(settings) {
  // SNI carries host names only (RFC 6066); for an address the certificate is still checked against it
  const servername = net.isIP(settings.tlsServername) === 0 ? settings.tlsServername : undefined;
  const tlsOptions = {
    servername,
    minVersion: 'TLSv1.2',
    checkServerIdentity: (host, cert) => tls.checkServerIdentity(settings.tlsServername, cert),
  };

  async function send({ from, to, message }) {
    let socket = settings.security === 'tls'
      ? tls.connect({ host: settings.host, port: settings.port, ...tlsOptions })
      : net.connect({ host: settings.host, port: settings.port });
    let reader = createReader();
    let unbind = bind(socket, reader, settings.timeoutMs);

    // label instead of the raw line in errors - an AUTH line carries the credentials
    async function command(line, label, expected) {
      if (line !== null) {
        socket.write(line + '\r\n');
      }
      const reply = await reader.next();
      if (!expected.includes(reply.code)) {
        throw new SmtpError(`${label} -> ${reply.lines[reply.lines.length - 1]}`);
      }
      return reply;
    }

    try {
      await command(null, 'greeting', [220]);
      let ehlo = await command(`EHLO ${settings.helo}`, 'EHLO', [250]);

      if (settings.security === 'starttls') {
        if (!extensions(ehlo).includes('STARTTLS')) {
          throw new SmtpError('the server does not offer STARTTLS');
        }
        await command('STARTTLS', 'STARTTLS', [220]);
        unbind();
        const plain = socket;
        socket = tls.connect({ socket: plain, ...tlsOptions });
        reader = createReader();
        unbind = bind(socket, reader, settings.timeoutMs);
        await new Promise((resolve, reject) => {
          socket.once('secureConnect', resolve);
          socket.once('error', reject);
        });
        ehlo = await command(`EHLO ${settings.helo}`, 'EHLO', [250]);
      }

      if (settings.username !== '') {
        const auth = extensions(ehlo).find((e) => e.startsWith('AUTH ')) ?? '';
        const mechanisms = auth.split(/\s+/).slice(1);
        if (mechanisms.includes('PLAIN')) {
          const token = Buffer.from(`\u0000${settings.username}\u0000${settings.password}`, 'utf8').toString('base64');
          await command(`AUTH PLAIN ${token}`, 'AUTH PLAIN', [235]);
        }
        else if (mechanisms.includes('LOGIN')) {
          await command('AUTH LOGIN', 'AUTH LOGIN', [334]);
          await command(Buffer.from(settings.username, 'utf8').toString('base64'), 'AUTH LOGIN username', [334]);
          await command(Buffer.from(settings.password, 'utf8').toString('base64'), 'AUTH LOGIN password', [235]);
        }
        else {
          throw new SmtpError('the server offers neither AUTH PLAIN nor AUTH LOGIN');
        }
      }

      await command(`MAIL FROM:<${from}>`, 'MAIL FROM', [250]);
      await command(`RCPT TO:<${to}>`, 'RCPT TO', [250, 251]);
      await command('DATA', 'DATA', [354]);
      const stuffed = message.replace(/\r\n$/, '').replace(/^\./gm, '..');
      await command(stuffed + '\r\n.', 'message', [250]);
      await command('QUIT', 'QUIT', [221]).catch(() => {});
    }
    finally {
      unbind();
      socket.destroy();
    }
  }

  return { send };
}
