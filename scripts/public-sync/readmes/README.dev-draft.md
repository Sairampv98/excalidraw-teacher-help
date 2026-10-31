# Excalidraw for the classroom - the contributors' branch

This branch, **`dev-draft`**, is where you commit.

## How to contribute

1. **Commit here.** Make your change on this branch, with a message that says what the change is for in plain words.
2. **Open a pull request from `dev-draft` to `dev`.** Pull requests are taken into `dev` only. Nothing is merged into `main` from a pull request.
3. **What happens to it.** The maintainer reads the change and describes it as a feature, rebuilds it in the maintainer's own tree with its tests, and publishes it to `dev` - then your pull request is closed with thanks. This is so that every feature in the project has a written description and a test that fails without it.
4. **What is checked first.** The pull request must say what the user sees; it must not add a dependency without saying why; it must not contain a secret, a path of your own machine, or a file you do not own the rights to.

The project itself is described in the [README of `main`](../../tree/main#readme). Please read its **Known limitations** first.

## The branches

| Branch | What it is |
| --- | --- |
| `main` | The current release. Only the maintainer merges into it. |
| `dev` | Follows `main` and the maintainer's work; pull requests go here. |
| `dev-draft` | This branch. It is brought back in line with `dev` after each pull request is taken - pull before you start. |
| `v1.1` | The first release with its repairs. |
| `v1` | The first release, kept as it was published. Superseded. |

## Licence

MIT - see [LICENSE](LICENSE).
