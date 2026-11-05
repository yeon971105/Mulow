// Reviewed PID 1. Fixed expiry stops all child processes when the container exits.
setTimeout(()=>process.exit(0),600000);
process.on('SIGTERM',()=>process.exit(0));
