<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/id</h1>
  <br/>
  <p align="center">
    Utilities for working with ids.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/id" rel="nofollow"><img src="https://jsr.io/badges/@temelj/id" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/id">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/id">npm</a>
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
$ npm install @temelj/id
# jsr
$ deno add jsr:@temelj/id # or jsr add @temelj/id
```

## Usage

Generate ULIDs.

```ts
import { generateUlid, generateUlidList } from "@temelj/id";

// e.g. 005800001A000G40R40M30E209
console.log(generateUlid({}));

// Generates 10 ULIDs with monotonicity.
console.log(generateUlidList(5));
```

Generate UUIDs.

```ts
import {
  generateUuid4,
  getUuid4Bytes,
  isUuid4Valid,
  makeUuid4FromBytes,
} from "@temelj/id";
import { expect, test } from "vitest";

const id = generateUuid4();
assert(isUuid4Valid(id));

const bytes = getUuid4Bytes(id);
assertEquals(id, makeUuid4FromBytes(bytes));
```

## About

This package is part of [Temelj](https://github.com/tinrab/temelj) - a big
standard library for TypeScript.
