const config = require('./config');
const app = require('./app');

// Optional standalone mode for API-only development. The recommended
// marketplace setup mounts this API inside the root server on PORT 3000.
app.listen(config.port, () => {
  console.log(`Emmyjosh Logs API listening on :${config.port} (${config.env})`);
});
