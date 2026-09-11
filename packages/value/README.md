<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/value</h1>
  <br/>
  <p align="center">
    Utilities for working with plain TypeScript values.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/value" rel="nofollow"><img src="https://jsr.io/badges/@temelj/value" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/value">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/value">npm</a>
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
$ npm install @temelj/value
# jsr
$ deno add jsr:@temelj/value # or jsr add @temelj/value
```

## About

Primitive guards such as `isString`, `isNumber`, `isBoolean`, `isBigInt`, and
`isSymbol` narrow unknown boundary values. `isObject` excludes null and functions.
`isPlainObject` verifies the object prototype; it does not establish a property schema.

`recordMerge` uses the `isMergeable` option for a custom mergeability predicate.
The `arrayMerge` and `isMergeable` callback types come from `deepmerge`.

This package is part of [Temelj](https://github.com/tinrab/temelj) - a core library for TypeScript.
