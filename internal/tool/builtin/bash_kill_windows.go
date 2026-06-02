package builtin

import (
	"os/exec"
	"strconv"
)

// setKillTree makes a cancelled command kill its whole process tree. Windows does
// not cascade a kill to child processes, so killing the shell leaves `go test`
// and the test binaries it spawned running after an Esc; taskkill /T walks the
// PID tree and /F forces it.
func setKillTree(cmd *exec.Cmd) {
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		_ = exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(cmd.Process.Pid)).Run()
		return cmd.Process.Kill()
	}
}
