# peer-account
agent for self-sovereign, private account stores

Structure:
* PeerAccount Class
  - genAccountIndex: creates an account index which keeps track of the account state
  - login: mounts the account index and returns an instance of PeerAccount
* PeerAccount Instance
  - manifest: tracks every orbitdb store opened and dropped by the account
  - profiles: manages profile sessions owned or viewed by the account
  - inbox: view session offers sent to the account, inbox address is viewable on the accounts profile
  - contacts: manages contact sessions used by the account, contact sessions are used for private messaging and session offers
