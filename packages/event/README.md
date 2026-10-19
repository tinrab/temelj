<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/event</h1>
  <br/>
  <p align="center">
    Strictly typed publish/subscribe utilities.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/event" rel="nofollow"><img src="https://jsr.io/badges/@temelj/event" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/event">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/event">npm</a>
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
$ npm install @temelj/event
# jsr
$ deno add jsr:@temelj/event # or jsr add @temelj/event
```

## Usage

```ts
import { createPubSub } from "@temelj/event";

type AppEvents = {
  "user:login": { userId: string };
  "user:logout": void;
};

const bus = createPubSub<AppEvents>();

bus.on("user:login", (payload) => {
  console.log(payload.userId);
});

bus.on("user:*", (_payload, event) => {
  console.log(event);
});

bus.emit("user:login", { userId: "user_1" });
bus.emit("user:logout");
```

`emit` continues dispatching after a handler fails and returns all failures.
A failure with `kind: "returned"` contains the handler's typed `error`.
A failure with `kind: "thrown"` contains an unknown `cause`, since JavaScript
can throw values outside the declared handler error type.

## About

This package is part of [Temelj](https://github.com/tinrab/temelj) - a core library for TypeScript.
