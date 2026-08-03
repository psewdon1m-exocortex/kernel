# ADR 0001: Framework boundaries

Status: accepted.

Open Node is a framework first. Its model is independent from React and any third-party graph UI; the reference application consumes the same packages as an embedding host. Canvas and execution are separate. Group is decorative, Container is a one-input/one-output serial processor, and arbitrary computational cycles are forbidden in v0.

Core contains no Exocortex/Kernel business entities, authentication, cloud synchronization, secrets or dynamic untrusted plugin installation. These concerns enter through host adapters and trusted plugins.
