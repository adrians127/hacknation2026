cmake_minimum_required(VERSION 3.28)

project(worker-manager
  VERSION 0.1.0
  DESCRIPTION "Attack Surface Intelligence worker manager: splits jobs into tasks and runs workers"
  LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

find_package(nlohmann_json 3.11 REQUIRED)
find_package(Threads REQUIRED)

# Everything but main.cpp, so the tests link the same code.
add_library(worker-manager-core STATIC
  src/config.cpp
  src/files.cpp
  src/footprint.cpp
  src/ipv4.cpp
  src/job.cpp
  src/logger.cpp
  src/planner.cpp
  src/process.cpp
  src/scheduler.cpp
  src/task_runner.cpp
)
target_include_directories(worker-manager-core PUBLIC src)
target_link_libraries(worker-manager-core PUBLIC nlohmann_json::nlohmann_json Threads::Threads)
target_compile_definitions(worker-manager-core PUBLIC
  WORKER_MANAGER_VERSION="${PROJECT_VERSION}"
)
target_compile_options(worker-manager-core PUBLIC
  -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Werror
)

add_executable(worker-manager src/main.cpp)
target_link_libraries(worker-manager PRIVATE worker-manager-core)

install(TARGETS worker-manager RUNTIME DESTINATION bin)

include(CTest)
if(BUILD_TESTING)
  add_executable(worker-manager-tests tests/unit_tests.cpp)
  target_link_libraries(worker-manager-tests PRIVATE worker-manager-core)
  add_test(NAME unit COMMAND worker-manager-tests)

  # End to end: the real manager binary drives a fake worker (a shell script).
  add_test(NAME e2e
    COMMAND sh ${CMAKE_CURRENT_SOURCE_DIR}/tests/e2e_test.sh
            $<TARGET_FILE:worker-manager> ${CMAKE_CURRENT_SOURCE_DIR}/tests/fake-worker.sh)
endif()
