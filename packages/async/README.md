<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/async</h1>
  <br/>
  <p align="center">
    Various async utilities.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/async" rel="nofollow"><img src="https://jsr.io/badges/@temelj/async" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/async">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/async">npm</a>
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
$ npm install @temelj/async
# jsr
$ deno add jsr:@temelj/async # or jsr add @temelj/async
```

## About

`attempt(fn, args)` requires the argument tuple, including `[]` for a function with no arguments.
`timeout(promise, ms)` accepts a promise. Use `Promise.try(fn)` to create one from a callback.
An undefined timeout fallback means no fallback and rejects with `TimeoutError`.

Retry options use `delay` for a fixed duration and `backoff` for a function of the attempt number.
`AsyncStream.retry(options)` retries all preceding pipeline operations. Each retry consumes
the source again, so use a repeatable iterable when restarting from the beginning is required.

This package is part of [Temelj](https://github.com/tinrab/temelj) - a core library for TypeScript.
