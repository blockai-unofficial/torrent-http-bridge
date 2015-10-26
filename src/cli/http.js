import path from 'path';
import serveStatic from 'serve-static';
import finalhandler from 'finalhandler';
import http from 'http';

const exit = (msg) => {
  console.error(msg);
  process.exit(1);
};

const serve = serveStatic(path.join(__dirname, '../../test/static'));

const httpServer = http.createServer((req, res) => {
  const done = finalhandler(req, res);
  serve(req, res, done);
});

httpServer.on('error', exit);

httpServer.listen(6000, () => {
  const port = httpServer.address().port;
  console.log('http listenintg on', port);
});
