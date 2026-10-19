import { StaticExample } from "@/components/static-example";

import { dynamicMdxSource } from "../../content.ts";

export default function Page(): React.ReactNode {
  return <StaticExample initialSource={dynamicMdxSource} />;
}
