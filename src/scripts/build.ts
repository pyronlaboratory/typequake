import { $ } from "bun";

async function build() {
  console.log("Building typequake binary...");

  await $`bun build src/cli.ts \
  --compile \
  --target=bun \
  --outfile=typequake`;

  console.log("Binary built: ./typequake");
}

build();
