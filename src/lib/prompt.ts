// Tiny stdin prompt helper. Works over SSH (stdin is still a TTY).
// Returns the trimmed answer, or throws if there's no TTY to read from.

import { createInterface } from "node:readline/promises";

export async function ask(question: string, opts: { mask?: boolean } = {}): Promise<string> {
	if (!process.stdin.isTTY) {
		throw new Error(
			"This command needs interactive input. Run it with a TTY, or pass the value via a flag / env var.",
		);
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		if (opts.mask) {
			// Best-effort masking: suppress echo while the user types the secret.
			const out = process.stdout;
			const onData = () => out.write("\x1b[2K\r");
			process.stdout.write(question);
			(process.stdin as NodeJS.ReadStream).on("data", onData);
			try {
				const answer = await rl.question("");
				return answer.trim();
			} finally {
				(process.stdin as NodeJS.ReadStream).removeListener("data", onData);
				out.write("\n");
			}
		}
		const answer = await rl.question(question);
		return answer.trim();
	} finally {
		rl.close();
	}
}

export async function confirm(question: string, def = false): Promise<boolean> {
	const suffix = def ? " [Y/n] " : " [y/N] ";
	const ans = (await ask(question + suffix)).toLowerCase();
	if (ans === "") return def;
	return ans === "y" || ans === "yes" || ans === "j" || ans === "já";
}
