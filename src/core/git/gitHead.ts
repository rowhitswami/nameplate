/** Parses the contents of `.git/HEAD`. */

export type GitHead =
  | { readonly kind: 'branch'; readonly name: string }
  | { readonly kind: 'detached'; readonly commit: string }
  | { readonly kind: 'ref'; readonly ref: string }
  | { readonly kind: 'unknown' };

export function parseGitHead(text: string | undefined): GitHead {
  const content = (text ?? '').trim();
  if (content.length === 0) {
    return { kind: 'unknown' };
  }
  if (content.startsWith('ref:')) {
    const ref = content.slice(4).trim();
    if (ref.startsWith('refs/heads/')) {
      return { kind: 'branch', name: ref.slice('refs/heads/'.length) };
    }
    return ref.length > 0 ? { kind: 'ref', ref } : { kind: 'unknown' };
  }
  if (/^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(content)) {
    return { kind: 'detached', commit: content.toLowerCase() };
  }
  return { kind: 'unknown' };
}

/** Short, human readable form: branch name, `abc1234 (detached)` or the ref. */
export function describeGitHead(head: GitHead): string | undefined {
  switch (head.kind) {
    case 'branch':
      return head.name;
    case 'detached':
      return `${head.commit.slice(0, 7)} (detached)`;
    case 'ref':
      return head.ref;
    case 'unknown':
      return undefined;
  }
}
