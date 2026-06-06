import * as React from "react";

/**
 * Reports whether the component has mounted on the client.
 */
export function useIsClient(): boolean {
  const [client, setClient] = React.useState(false);
  React.useEffect(() => setClient(true), []);
  return client;
}
