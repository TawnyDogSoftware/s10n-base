import { useEffect } from "react";

import { useBootstrapQuery } from "../rpc/queries";
import { connectActivityStream } from "../rpc/client";
import { useActivityStore } from "../store/activityStore";

export function useActivityStream() {
  const bootstrapQuery = useBootstrapQuery();
  const setSnapshot = useActivityStore((state) => state.setSnapshot);
  const appendActivity = useActivityStore((state) => state.appendActivity);

  useEffect(() => {
    if (!bootstrapQuery.data?.websocketUrl) {
      return;
    }

    return connectActivityStream(bootstrapQuery.data.websocketUrl, (message) => {
      if (message.type === "activity.snapshot") {
        setSnapshot(message.activities);
        return;
      }
      appendActivity(message.activity);
    });
  }, [appendActivity, bootstrapQuery.data?.websocketUrl, setSnapshot]);
}
