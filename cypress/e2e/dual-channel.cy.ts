describe('Dual-channel LSP transport', () => {
  it('opens one paired session and supports initialize, edit, and completion', () => {
    const socketUrls: string[] = []
    cy.visit('/#project=Stable', {
      onBeforeLoad(win) {
        const NativeWebSocket = win.WebSocket
        class TrackingWebSocket extends NativeWebSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            socketUrls.push(url.toString())
            super(url, protocols)
          }
        }
        win.WebSocket = TrackingWebSocket
      },
    })

    cy.iframe().contains('All Messages (0)').should('exist')
    cy.get('div.view-line').type(
      'example (P: Prop) : P \\or \\not P := by appl',
      { delay: 100 },
    )
    cy.containsAll('div.monaco-editor', ['by appl', 'apply?']).should('exist')

    cy.then(() => {
      const lspUrls = socketUrls
        .map((socketUrl) => new URL(socketUrl))
        .filter((socketUrl) => socketUrl.pathname.startsWith('/websocket/'))
      expect(lspUrls).to.have.length(2)
      expect(
        lspUrls.map((socketUrl) => socketUrl.searchParams.get('channel')),
      ).to.have.members(['hi', 'lo'])
      expect(lspUrls[0].searchParams.get('session')).to.equal(
        lspUrls[1].searchParams.get('session'),
      )
      expect(lspUrls[0].searchParams.get('session')).to.match(/^[a-f0-9]{32}$/)
    })
  })
})
