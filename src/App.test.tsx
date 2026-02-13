import { act, render, screen } from "@testing-library/react";
import App from "./App";
import { updateSettings } from "./lib/tauriClient";
import { AppStateProvider } from "./state/appState";

describe("App", () => {
  it("renders conversation chat interface when conversation threads are enabled", async () => {
    await act(async () => {
      await updateSettings({ conversationThreadsV1: true });
      render(
        <AppStateProvider>
          <App />
        </AppStateProvider>
      );
      await Promise.resolve();
    });

    expect(screen.getByText("Send a message to get started.")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
  });

  it("renders legacy chat interface when conversation threads are disabled", async () => {
    await act(async () => {
      await updateSettings({ conversationThreadsV1: false });
      render(
        <AppStateProvider>
          <App />
        </AppStateProvider>
      );
      await Promise.resolve();
    });

    expect(screen.getByText("Classic chat mode")).toBeInTheDocument();
    expect(screen.getByText("conversation threads are disabled")).toBeInTheDocument();
  });
});
