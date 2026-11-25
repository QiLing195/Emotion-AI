function installConsolePipeGuards(stdout = process.stdout, stderr = process.stderr) {
  const handleStreamError = (error) => {
    if (error?.code === 'EPIPE') return;
    throw error;
  };

  stdout.on('error', handleStreamError);
  stderr.on('error', handleStreamError);

  return () => {
    stdout.removeListener('error', handleStreamError);
    stderr.removeListener('error', handleStreamError);
  };
}

module.exports = { installConsolePipeGuards };
