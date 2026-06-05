module.exports = {
  apps: [{
    name: 'raven-bridge',
    script: 'server.js',
    cwd: '/root/ripple-and-serena/raven-bridge',
    restart_delay: 3000,
    max_restarts: 10
  }]
}
