// @deno-types="@types/react"
import type React from "react";
import { useEffect, useState } from "react";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import {
  headingIdPlugin,
  type MdxArtifact,
  MdxCompiler,
  syntaxHighlightPlugin,
} from "@temelj/mdx";
import { createMdxContent } from "@temelj/mdx-react";
import { getMdxComponents } from "./components/registry.tsx";

export function App(): React.ReactNode {
  const [artifact, setArtifact] = useState<MdxArtifact<unknown> | undefined>();
  const [content, setContent] = useState<React.ReactNode>();

  useEffect(() => {
    (async () => {
      const compiler = new MdxCompiler()
        // .withRemarkPlugin(removeImportsExportsPlugin)
        // @ts-ignore missing types
        .withRemarkPlugin(remarkMath)
        .withRehypePlugin(headingIdPlugin)
        .withRehypePlugin(syntaxHighlightPlugin, {
          includeDataAttributes: ["language", "source-code", "line-count"],
          highlight: {},
          lineNumbers: {},
          commandLine: {},
          // shikiHastOptions: {
          // 	themes: {
          // 		light: lightTheme,
          // 		dark: darkTheme,
          // 	},
          // },
        })
        // @ts-ignore missing types
        .withRehypePlugin(rehypeKatex);

      const result = await compiler.compile(
        `
---
title: Hello, World!
description: This is a demo post.
---

Lorem ipsum dolor sit amet consectetur adipisicing elit. Eveniet, nisi voluptate esse omnis illum iste explicabo dolor dicta eaque nobis.

# Code

\`\`\`c { "highlight": "9", "showLineNumbers": true, "fileName": "src/main.c" }
float Q_rsqrt( float number )
{
	long i;
	float x2, y;
	const float threehalfs = 1.5F;

	x2 = number * 0.5F;
	y  = number;
	i  = * ( long * ) &y;						// evil floating point bit level hacking
	i  = 0x5f3759df - ( i >> 1 );               // what the fuck?
	y  = * ( float * ) &i;
	y  = y * ( threehalfs - ( x2 * y * y ) );   // 1st iteration
//	y  = y * ( threehalfs - ( x2 * y * y ) );   // 2nd iteration, this can be removed

	return y;
}
\`\`\`

# Command line

Lorem ipsum dolor sit amet, consectetur \`f(n) = n * 2\` adipisicing elit. Enim, velit.

\`\`\`bash { "commandLine": "0" }
ls -la
total 12
drwxrwxr-x  3 tin  tin  4096 Jun  7 03:17 .
drwxrwxrwt 27 root root 4096 Jun  7 03:17 ..
-rw-rw-r--  1 tin  tin     0 Jun  7 03:17 a.txt
drwxrwxr-x  2 tin  tin  4096 Jun  7 03:17 b
\`\`\`

# Math

Lorem ipsum dolor $E=mc^2$ sit amet.

$$
\\hat{f} (\\xi)=\\int_{-\\infty}^{\\infty}f(x)e^{-2\\pi ix\\xi}dx
$$

Lorem ipsum, dolor sit amet consectetur adipisicing elit. Deserunt, nam.

# Exported component

export function Demo() {
  let count = 0;
  return (
    <div className="border p-4">
      <h1>Hello, JSX!</h1>
    </div>
  );
}

<Demo />
          `.trim(),
        {},
      );
      setArtifact(result);

      setContent(createMdxContent({ artifact: result }, getMdxComponents()));
    })();
  }, []);

  return (
    <div className="mx-auto p-8">
      <h1 className="underline">MDX</h1>

      {artifact && content && (
        <>
          <pre>{JSON.stringify(artifact.frontmatter, null, 2)}</pre>

          <div>{content}</div>
        </>
      )}
    </div>
  );
}
