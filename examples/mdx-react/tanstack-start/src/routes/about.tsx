import { createFileRoute } from "@tanstack/react-router";

import Content from "../content/about.mdx";

export const Route = createFileRoute("/about")({ component: Content });
