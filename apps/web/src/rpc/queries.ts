import { useQuery } from "@tanstack/react-query";

import { getBootstrapConfig } from "./client";

export const queryKeys = {
  bootstrap: ["bootstrap"] as const,
};

export function useBootstrapQuery() {
  return useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: getBootstrapConfig,
  });
}
