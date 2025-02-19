<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/mdx-react</h1>
  <br/>
  <p align="center">
    Helpers for rendering MDX with React.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/mdx-react" rel="nofollow"><img src="https://jsr.io/badges/@temelj/mdx-react" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/mdx-react">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/mdx-react">npm</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/tinrab/temelj/issues/new">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://twitter.com/tinrab">@tinrab</a>
  <br />
</div>

<br/>
<br/>

## Installation

```sh
# npm
$ npm install @temelj/mdx-react
# jsr
$ deno add jsr:@temelj/mdx-react # or jsr add @temelj/mdx-react
```

## Usage

To render the MDX artifact, you call the `createMdxContent` function. It will
evaluate the compiled "function body" and return a React node. You can also
override components with your custom ones.

```tsx ignore
import { createMdxContent, MdxCompiler } from "@temelj/mdx";

const compiler = new MdxCompiler();
const page = await compiler.compile(source, {
  mdxOptions: {
    // This is always 'function-body'.
    // outputFormat: "function-body",
    // Or 'undefined' if rendering server-side as a RSC.
    providerImportSource: "@mdx-js/react",
  },
});

const node = createMdxContent({ artifact: page }, mdxPageComponents);

const rendered = <div>{node}</div>;
```

You will also need to include a CSS file. You can find an example in
`./examples/mdx-react/basic`.
