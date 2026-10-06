# Security

Nameplate runs entirely inside VS Code, makes no network requests, executes no external processes and reads only a handful of well-known files at the root of the open workspace and inside its `.git` directory. It writes to the workspace settings file, to `.git/info/exclude` and to VS Code's extension storage.

If you believe you have found a security issue (for example a way to make Nameplate write outside those locations, or to leak repository credentials through the UI), please open a private security advisory on GitHub rather than a public issue.
