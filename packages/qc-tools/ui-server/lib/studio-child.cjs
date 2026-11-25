// The pinned Remotion CLI binds publicly by default. Restrict its private server.
const {RenderInternals} = require('@remotion/renderer');
RenderInternals.getPortConfig = () => ({host: '127.0.0.1', hostsToTry: ['127.0.0.1']});
require('@remotion/cli').cli().catch(error => { console.error(error); process.exit(1); });
