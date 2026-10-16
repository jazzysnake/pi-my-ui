# The wire protocol has no versioning

Status: accepted. Supersedes v1 ADRs 0019 and 0020's versioning machinery.

Client and server ship together, so v2 has no `PROTOCOL_VERSION`, no version negotiation in the handshake, and no multi-version evolution rules. A shared `protocol` package still defines the contract once, with runtime validators for every inbound message and the cursor/delta semantics; a message that fails validation is rejected loudly. Changing the protocol means changing both ends in one commit.

v1 spent a large share of its ADRs, validators, tests and "update both servers" rules on evolving a contract that only ever had one deployer.
