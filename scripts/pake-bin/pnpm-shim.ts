const [command, ...args] = Bun.argv.slice(2);

if (command === "--version" || command === "-v") {
  console.log("10.26.2");
  process.exit(0);
}

const bunArgs = command === "run" ? ["run", ...args] : [command, ...args].filter(Boolean);
const child = Bun.spawn(["bun", ...bunArgs], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await child.exited);
