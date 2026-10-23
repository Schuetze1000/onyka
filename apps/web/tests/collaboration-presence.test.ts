import { describe, expect, it } from 'vitest'
import { uniqueCollaborators } from '../src/utils/collaborationPresence'

describe('Presence per account', () => {
  const phone = { id: 'alice', socketId: 'phone', name: 'Alex' }
  const desktop = { id: 'alice', socketId: 'desktop', name: 'Alex' }
  const otherUser = { id: 'bob', socketId: 'other', name: 'Alex' }
  it('counts multiple tabs and devices once, without merging users with the same name', () => {
    expect(uniqueCollaborators([phone, desktop, otherUser]).map(user => user.id)).toEqual(['alice', 'bob'])
  })
  it('keeps the person visible while one of their sessions remains', () => {
    expect(uniqueCollaborators([phone, desktop].filter(s => s.socketId !== 'phone'))).toEqual([desktop])
    expect(uniqueCollaborators([])).toEqual([])
  })
})
