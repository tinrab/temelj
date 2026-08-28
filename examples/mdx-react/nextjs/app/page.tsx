import { StaticExample } from "@/components/static-example";

import { staticMdxSource } from "../../content.ts";

export default function Page(): React.ReactNode {
  return <StaticExample initialSource={staticMdxSource} />;
}
