'use strict'
const sdk = require('./qxci_atom_sdk')

const input = sdk.getInput()
sdk.log.info('workspace=' + sdk.getWorkspace())
sdk.log.info('message=' + (input.message || ''))
sdk.setOutput({
  status: sdk.status.SUCCESS,
  message: 'ok',
  type: 'default',
  data: {
    echo: { type: 'string', value: String(input.message || 'hello') },
  },
})
