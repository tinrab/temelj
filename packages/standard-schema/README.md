<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/standard-schema</h1>
  <br/>
  <p align="center">
    Standard Schema construction utilities.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/standard-schema" rel="nofollow"><img src="https://jsr.io/badges/@temelj/standard-schema" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/standard-schema">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/standard-schema">npm</a>
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
$ npm install @temelj/standard-schema
# jsr
$ deno add jsr:@temelj/standard-schema # or jsr add @temelj/standard-schema
```

## Usage

```ts
import { ss } from "@temelj/standard-schema";

const schema = ss.string();
const result = schema["~standard"].validate("hello");
```

`SchemaFields` names an object's field schemas. `object` validates those fields and strips other keys; `strictObject` rejects extra keys. `looseObject` preserves extra keys at runtime, but its output type exposes only the validated fields.

`array()` checks the container and returns `unknown[]`. Pass an element schema, such as `array(string())`, to validate its elements. `fn()` checks that a value is callable; it does not validate the function's parameters or result.

`defaulted(schema, value)` uses the supplied value, including function values. Use `defaultedWith(schema, () => value)` to create a default only when the input is `undefined`.
