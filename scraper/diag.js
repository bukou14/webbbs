const WebSocket = require('ws');
const iconv = require('iconv-lite');
const { Terminal } = require('@xterm/headless');

const WS_URL = 'wss://term.gamer.com.tw/bbs';
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const term = new Terminal({ rows: 24, cols: 80, allowProposedApi: true });
  term.resize(80, 24);

  const ws = new WebSocket(WS_URL, { origin: 'https://term.gamer.com.tw', protocol: 'telnet' });
  const send = (str) => {
    ws.send(iconv.encode(str, 'big5'));
  };

  ws.on('open', async () => {
    console.log('[diag] Connected');
    await sleep(8000);
    console.log('[diag] Dumping splash...');
    let s = '';
    for (let i = 0; i < 24; i++) {
      const line = term.buffer.active.getLine(i);
      if (line) s += line.translateToString(true) + '\n';
    }
    console.log('SCREEN_LEN=' + s.length);
    console.log(s);

    console.log('[diag] Sending dismiss...');
    send('\r');
    await sleep(3000);
    s = '';
    for (let i = 0; i < 24; i++) {
      const line = term.buffer.active.getLine(i);
      if (line) s += line.translateToString(true) + '\n';
    }
    console.log('AFTER_DISMISS_LEN=' + s.length);
    console.log(s);

    const user = process.env.BBS_USER || '';
    console.log('[diag] Sending username...');
    const testBuf = iconv.encode(user + '\r', 'big5');
    console.log('[diag] Bytes to send:', testBuf.toString('hex'));
    send(user + '\r');
    await sleep(10000);
    s = '';
    for (let i = 0; i < 24; i++) {
      const line = term.buffer.active.getLine(i);
      if (line) s += line.translateToString(true) + '\n';
    }
    console.log('AFTER_USERNAME_LEN=' + s.length);
    console.log(s);

    ws.close();
    process.exit(0);
  });

  ws.on('message', (data) => {
    const text = iconv.decode(data, 'big5');
    if (text.includes(process.env.BBS_USER || '\u0000') || text.includes('代號')) {
      console.log('[diag] MSG relevant text, raw hex:', data.toString('hex').substring(0, 100));
      console.log('[diag] MSG text:', text.substring(0, 80));
    }
    term.write(text);
  });

  ws.on('close', () => { process.exit(0); });
}

main().catch(e => { console.error(e); process.exit(1); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(0); }, 120000);
