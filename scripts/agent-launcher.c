// A Mach-O sidecar can be signed and sealed; shell scripts in Contents/MacOS cannot.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  const char *runtime = getenv("CUE_AGENT_RUNTIME");
  char **args = calloc((size_t)argc + 4, sizeof(char *));
  if (!args) return 1;
  int offset;
  if (runtime && *runtime) {
    if (asprintf(&args[0], "%s/node", runtime) < 0 ||
        asprintf(&args[1], "%s/orchestrator.mjs", runtime) < 0) return 1;
    offset = 2;
  } else {
    const char *project = getenv("CUE_PROJECT_DIR");
    if (!project || chdir(project)) { fputs("Cue project directory unavailable\n", stderr); return 1; }
    args[0] = "node"; args[1] = "--import"; args[2] = "tsx"; args[3] = "orchestrator.ts";
    offset = 4;
  }
  for (int i = 1; i < argc; i++) args[offset + i - 1] = argv[i];
  execvp(args[0], args);
  perror("Cue agent launch");
  return 1;
}
