const http = require('http');
const serviceName = process.env.SERVICE_NAME || 'service';
const port = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', service: serviceName }));
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found', service: serviceName }));
});

server.listen(port, () => {
  console.log(`${serviceName} listening on ${port}`);
});
