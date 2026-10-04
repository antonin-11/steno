/*
 * Lance un programme en le rendant responsable de ses propres permissions macOS (TCC).
 *
 * Sans ça, le helper hérite du processus qui a lancé Sténo (node via launchd, ou le terminal) :
 * macOS lirait les textes de permission de ce processus, qui ne les a pas, au lieu de ceux du helper.
 *
 * Repris d'OpenWhispr (licence MIT, Copyright (c) 2024 OpenWhispr Team) :
 * resources/macos-disclaim-exec.c
 */

#include <spawn.h>
#include <stdio.h>

extern char **environ;
extern int responsibility_spawnattrs_setdisclaim(posix_spawnattr_t *attrs, int disclaim);

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <programme> [arguments...]\n", argv[0]);
        return 64;
    }
    posix_spawnattr_t attr;
    posix_spawnattr_init(&attr);
    /* Remplace ce processus au lieu d'en créer un autre : même pid et mêmes pipes pour l'appelant */
    posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETEXEC);
    responsibility_spawnattrs_setdisclaim(&attr, 1);
    int rc = posix_spawn(NULL, argv[1], NULL, &attr, &argv[1], environ);
    fprintf(stderr, "disclaim-exec: impossible de lancer %s : %d\n", argv[1], rc);
    return 127;
}
