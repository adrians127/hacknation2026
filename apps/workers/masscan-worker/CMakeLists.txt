cmake_minimum_required(VERSION 3.28)

project(masscan-worker
  VERSION 0.1.0
  DESCRIPTION "Attack Surface Intelligence fast TCP sweep worker (masscan)"
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
add_library(masscan-worker-core STATIC
  src/address.cpp
  src/config.cpp
  src/masscan_runner.cpp
  src/process.cpp
  src/report.cpp
  src/scan_job.cpp
  src/topology.cpp
)
target_include_directories(masscan-worker-core PUBLIC src)
target_link_libraries(masscan-worker-core PUBLIC nlohmann_json::nlohmann_json Threads::Threads)
target_compile_definitions(masscan-worker-core PUBLIC
  MASSCAN_WORKER_VERSION="${PROJECT_VERSION}"
)
target_compile_options(masscan-worker-core PUBLIC
  -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Werror
)

add_executable(masscan-worker src/main.cpp)
target_link_libraries(masscan-worker PRIVATE masscan-worker-core)

install(TARGETS masscan-worker RUNTIME DESTINATION bin)

include(CTest)
if(BUILD_TESTING)
  add_executable(masscan-worker-tests tests/unit_tests.cpp)
  target_link_libraries(masscan-worker-tests PRIVATE masscan-worker-core)
  add_test(NAME unit COMMAND masscan-worker-tests)
endif()
