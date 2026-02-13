import { act, render, screen } from "@testing-library/react";
import App from "./App";
import { AppStateProvider } from "./state/appState";

describe("App", () => {
  it("renders top-level heading", async () => {
    await act(async () => {
      render(
        <AppStateProvider>
          <App />
        </AppStateProvider>
      );
      await Promise.resolve();
    });

    expect(screen.getByText("Local CLI Command Center")).toBeInTheDocument();
  });
});
