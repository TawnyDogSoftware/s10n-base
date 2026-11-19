import "@testing-library/jest-dom/vitest";

// jsdom does not implement scrolling, and TanStack Router scrolls on navigation.
window.scrollTo = () => undefined;
