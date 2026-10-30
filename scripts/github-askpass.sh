#!/bin/sh
case "$1" in
  *Username*) printf '%s' 'gearline-lab' ;;
  *github.com*) /usr/bin/security find-internet-password -a gearline-lab -s github.com -w ;;
  *) exit 1 ;;
esac
