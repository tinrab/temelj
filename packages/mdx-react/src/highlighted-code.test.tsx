import { render } from "@testing-library/react";
import { expect, test } from "vitest";

import { HighlightedCode } from "./highlighted-code.tsx";

test("shows readable code without an external service", () => {
  const code = render(<HighlightedCode code="const x = 1" language="ts" />);
  expect(code.container.textContent).toBe("const x = 1\n");
  expect(code.container.querySelector("code")?.className).toBe("language-ts");
});
