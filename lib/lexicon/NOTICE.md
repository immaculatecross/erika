# morph-it attribution & license (NOTICE)

`morphit-lemmas.tsv.gz` in this directory is a **derived, reduced** asset built
from the **Morph-it!** free morphological resource for Italian:

> Marco Baroni and Eros Zanchetta. *Morph-it! A free corpus-based morphological
> resource for the Italian language.* University of Bologna / University of Trento.
> <https://docs.sslmit.unibo.it/doku.php?id=resources:morph-it>

## License

Morph-it! is distributed under the **Creative Commons
Attribution-ShareAlike 2.0** license (also available under the LGPL). This
attribution satisfies the **BY** term; the **SA** term is satisfied by
distributing this derived asset under the same license.

**The derived asset (`morphit-lemmas.tsv.gz`) is licensed CC BY-SA 2.0**, the same
license as the upstream data. It is not covered by the repository's own license.

## What the derivation does

The source is the raw Morph-it! table (`morph-it_048_utf8.txt`, ~505k rows,
tab-separated `form ⟶ lemma ⟶ features`). It is reduced by
`scripts/build-morphit-lemmas.ts` to the **distinct set of (lemma, POS) pairs**:

- morph-it feature tags are collapsed to this project's coarse POS scheme
  (`lib/lexicon/pos.ts`);
- punctuation, sentence, and symbol rows, and rows that map to no lexical POS, are
  dropped;
- malformed rows (not three tab fields) are skipped.

The result is ~38k `lemma\tPOS` lines, gzipped. No inflected forms, frequencies, or
morphological features are retained — only the canonical (lemma, POS) inventory the
lemma validator needs.

## Regenerating

The raw 19 MB source is **not** committed. To rebuild the asset:

```
git clone --depth 1 https://github.com/giodegas/morphit-lemmatizer
npx tsx scripts/build-morphit-lemmas.ts morphit-lemmatizer/master/morph-it_048_utf8.txt
```
