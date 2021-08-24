function writeChunkToStderr (procName, chunk) {
  let str = ''
  const date = new Date().toISOString()
  const lines = chunk.toString().trim().split('\n')
  for (let i = 0; i < lines.length; i++) {
    str += `${date} [${procName}]: ${lines[i]}\n`
  }
  process.stderr.write(str)
}

module.exports = {writeChunkToStderr}
